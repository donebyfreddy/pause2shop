import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { dhash } from "../images/dhash";
import { getConfig } from "../config/index";
import { logger } from "../observability/logger";
import { recordProviderUsage } from "../observability/metrics";
import { normalizeText } from "../normalization/normalize";

/**
 * Proveedores de embeddings.
 *
 * - `local`: @huggingface/transformers (transformers.js, ONNX) con CLIP por
 *   defecto (Xenova/clip-vit-base-patch32, 512 dims). Alternativas probadas
 *   por la comunidad: SigLIP (Xenova/siglip-base-patch16-224) y FashionCLIP
 *   (patrickjohncyh/fashion-clip vía conversión ONNX). Es una dependencia
 *   OPCIONAL cargada con import dinámico: si el paquete no está instalado o
 *   la descarga del modelo falla, degradamos a `hash` sin romper el servicio.
 *
 * - `hash`: fallback determinista SIEMPRE disponible. Deriva un vector
 *   normalizado de 64 dims del dHash (forma/estructura) + histograma de color.
 *   ⚠️ Solo para demo/tests: captura color y silueta gruesa, NO semántica
 *   visual. En producción hay que usar `local` (o un servicio externo).
 *
 * La dimensión NUNCA se hardcodea en la DB: se lee de `dimension()` del
 * provider activo al indexar.
 */

export interface EmbeddingProvider {
  readonly name: "local" | "hash";
  readonly model: string;
  /** Dimensión real del vector que produce este provider. */
  dimension(): number;
  embedImage(image: Buffer): Promise<number[]>;
  /**
   * Embedding de texto, o `null` si el proveedor no puede producir uno
   * compatible. Nulo y no un vector de otra dimensión: la columna
   * `text_embedding` es `vector(512)` y un vector de 64 no cabe — devolverlo
   * convertiría un "no puedo" en un error de escritura.
   */
  embedText(text: string): Promise<number[] | null>;
}

function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/* ------------------------------- hash provider ------------------------------- */

const HASH_DIM = 64;

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "hash" as const;
  readonly model = "dhash64+color-histogram";

  dimension(): number {
    return HASH_DIM;
  }

  /**
   * 32 dims de estructura (pares de bits del dHash) + 32 dims de histograma
   * RGB por bandas. Determinista: la misma imagen produce el mismo vector,
   * que es lo que necesitan los tests y la demo sin red.
   */
  async embedImage(image: Buffer): Promise<number[]> {
    const hash = await dhash(image);
    const bits = BigInt("0x" + hash);
    const structural: number[] = [];
    for (let i = 0; i < 32; i++) {
      // Cada par de bits → valor en {-1,-0.33,0.33,1}: conserva más señal
      // que un bit suelto y mantiene 32 dims.
      const pair = Number((bits >> BigInt(i * 2)) & 3n);
      structural.push((pair - 1.5) / 1.5);
    }
    const { data, info } = await sharp(image)
      .resize(32, 32, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Histograma: 8 bandas de intensidad por canal RGB + 8 de luminancia
    const hist = new Array(32).fill(0);
    const pixels = info.width * info.height;
    for (let i = 0; i < pixels; i++) {
      const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
      hist[Math.min(7, r >> 5)] += 1;
      hist[8 + Math.min(7, g >> 5)] += 1;
      hist[16 + Math.min(7, b >> 5)] += 1;
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      hist[24 + Math.min(7, lum >> 5)] += 1;
    }
    const histNorm = hist.map((h) => h / pixels);
    return l2normalize([...structural, ...histNorm]);
  }

  /** Hashing de tokens en 64 dims (bag-of-words con signo). Determinista;
   * captura solapamiento léxico, no semántica — documentado como limitación. */
  async embedText(text: string): Promise<number[]> {
    const v = new Array(HASH_DIM).fill(0);
    for (const token of normalizeText(text).split(" ").filter(Boolean)) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % HASH_DIM;
      v[idx] += h % 2 === 0 ? 1 : -1;
    }
    return l2normalize(v);
  }
}

/* ------------------------------- local provider ------------------------------- */

/**
 * Precisión de los pesos de CLIP. `q8` = cuantización a entero de 8 bits.
 *
 * Sin fijarlo, transformers.js avisa ("dtype not specified … using fp32") y se
 * baja los pesos en coma flotante de 32 bits. Medido en la caché real:
 *
 *   vision_model.onnx   fp32  335 MB      q8   96 MB
 *   text_model.onnx     fp32  242 MB      q8   62 MB
 *
 * En una función serverless eso se paga en CADA arranque en frío, porque el
 * modelo se descarga de HuggingFace a /tmp y /tmp muere con la instancia.
 * Medido en producción con fp32: la petición tardaba 10-12 s y el catálogo
 * expiraba, así que 4 de cada 5 búsquedas devolvían "sin coincidencias".
 *
 * Junto con la torre de texto perezosa (ver `ensureTextTower`), el arranque
 * en frío baja de 577 MB (335 + 242) a 96 MB: seis veces menos.
 *
 * IMPORTANTE — esto tiene que ser el MISMO valor con el que se indexó el
 * catálogo. La cuantización mueve ligeramente los vectores; consultar en q8
 * contra un índice fp32 no rompe nada (la dimensión sigue siendo 512 y el
 * coseno sigue siendo alto), pero baja la similitud justo donde más duele,
 * cerca del umbral. Si se cambia, hay que reindexar:
 *   npm run catalog:embeddings:reindex
 */
const EMBEDDING_DTYPE = "q8";

class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local" as const;
  readonly model: string;
  private dim = 0;
  private imagePipeline: any = null;
  /** Módulo transformers ya importado, para no repetir la resolución. */
  private transformers: any = null;
  /** Tokenizador y torre de TEXTO de CLIP, cargados aparte y bajo demanda. */
  private tokenizer: any = null;
  private textModel: any = null;
  /** La torre de texto se intenta UNA vez; si falla, no se reintenta. */
  private textTowerTried = false;

  constructor(model: string) {
    this.model = model;
  }

  async init(): Promise<void> {
    // Import dinámico: el paquete puede no estar instalado (es opcional).
    const transformers: any = await optionalTransformersImport();
    this.transformers = transformers;
    configureModelCache(transformers);
    this.imagePipeline = await transformers.pipeline(
      "image-feature-extraction",
      this.model,
      { dtype: EMBEDDING_DTYPE }
    );
    // La torre de TEXTO ya no se carga aquí: ver `ensureTextTower()`.
  }

  /**
   * Torre de texto (tokenizador + CLIPTextModelWithProjection), BAJO DEMANDA.
   *
   * No es un pipeline de "feature-extraction" sobre el modelo completo: eso
   * carga el CLIP entero, que exige `input_ids` Y `pixel_values`, y reventaba
   * en la llamada con "Missing the following inputs: pixel_values" — el
   * reindex terminaba con errores y sin actualizar nada.
   *
   * Es PEREZOSA porque solo la usan el reindex y la búsqueda por texto,
   * mientras que el camino caliente (embeber el recorte del usuario) solo
   * necesita la de imagen. Cargarla en `init()` costaba descargar
   * `text_model.onnx` en CADA arranque en frío de la función serverless para
   * no usarla nunca.
   *
   * Devuelve 512 dimensiones, el MISMO espacio que las imágenes.
   */
  private async ensureTextTower(): Promise<void> {
    if (this.textTowerTried) return;
    this.textTowerTried = true;
    try {
      const transformers = this.transformers ?? (await optionalTransformersImport());
      this.tokenizer = await transformers.AutoTokenizer.from_pretrained(this.model);
      this.textModel = await transformers.CLIPTextModelWithProjection.from_pretrained(
        this.model,
        { dtype: EMBEDDING_DTYPE }
      );
    } catch (err) {
      logger.warn("embeddings: torre de texto no disponible", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
      });
      this.tokenizer = null;
      this.textModel = null;
    }
  }

  dimension(): number {
    return this.dim;
  }

  async embedImage(image: Buffer): Promise<number[]> {
    // transformers.js acepta rutas/URLs/RawImage; convertimos el buffer a PNG RGBA raw
    const { data, info } = await sharp(image)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const transformers: any = await optionalTransformersImport();
    const raw = new transformers.RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
    const output = await this.imagePipeline(raw, { pooling: "mean", normalize: true });
    const vec = Array.from(output.data as Float32Array);
    this.dim = vec.length; // la dimensión se lee del modelo, nunca se asume
    return vec;
  }

  /**
   * Embedding de texto en el espacio de CLIP.
   *
   * Devuelve `null` cuando la torre de texto no está disponible, y NO un vector
   * del proveedor `hash`: el hash produce 64 dimensiones y la columna
   * `text_embedding` es `vector(512)`, así que devolverlo rompería el guardado.
   * Sin dato es mejor que un dato que no cabe.
   */
  async embedText(text: string): Promise<number[] | null> {
    await this.ensureTextTower();
    if (!this.tokenizer || !this.textModel) return null;
    try {
      const inputs = await this.tokenizer([text], {
        padding: true,
        truncation: true,
      });
      const { text_embeds } = await this.textModel(inputs);
      const vec = Array.from(text_embeds.data as Float32Array);
      // Normalizado L2, igual que el de imagen: si no, el coseno entre ambos
      // espacios no sería comparable.
      const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
      return vec.map((x) => x / norm);
    } catch (err) {
      logger.warn("embeddings: fallo al embeber texto", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

/**
 * Keep the large ONNX runtime genuinely optional. A literal dynamic import is
 * still resolved at build time by Turbopack, so use a runtime importer and
 * fall back to the built-in hash provider when the package is absent.
 *
 * OJO: esconder el import del bundler tiene un precio — el file tracing de Next
 * tampoco lo ve, así que el paquete NO viaja solo a la función serverless. Se
 * fuerza desde next.config.ts (`serverExternalPackages` +
 * `outputFileTracingIncludes`). Si algún día se quita de ahí, esto degrada a
 * `hash` en producción sin un solo error en los logs.
 */
async function optionalTransformersImport(): Promise<any> {
  const runtimeImport = new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<any>;

  /**
   * DOS intentos, y hacen falta los dos.
   *
   * 1. Por nombre de paquete. Es lo correcto: respeta el mapa `exports`, que
   *    es lo que devuelve la entrada ESM con `pipeline` como named export.
   *    Funciona en dev y en los scripts de CLI.
   * 2. Por RUTA ABSOLUTA. Un `import()` dentro de `new Function` no tiene
   *    módulo referente, así que el especificador *bare* se resuelve contra el
   *    contexto del `eval` y no contra este fichero. En la función serverless
   *    el bundle vive en `.next/server/...` y el paso 1 falla ahí.
   *    `createRequire(import.meta.url)` sí resuelve relativo a ESTE módulo.
   *
   * El paso 2 salta el mapa `exports` y cae en el entry de `main`, así que el
   * módulo puede llegar envuelto en `default` — de ahí el desempaquetado. Sin
   * él, el fallo es "transformers.pipeline is not a function" y se degrada a
   * hash como si el paquete no estuviera.
   */
  const unwrap = (mod: any): any =>
    mod && typeof mod.pipeline !== "function" && mod.default ? mod.default : mod;

  try {
    return unwrap(await runtimeImport("@huggingface/transformers"));
  } catch {
    const abs = pathToFileURL(
      createRequire(import.meta.url).resolve("@huggingface/transformers")
    ).href;
    return unwrap(await runtimeImport(abs));
  }
}

/**
 * Dónde deja transformers.js los pesos del modelo (~90 MB ONNX).
 *
 * Por defecto los escribe DENTRO del paquete
 * (`node_modules/@huggingface/transformers/.cache`), que en una función
 * serverless es de SOLO LECTURA: la descarga falla, `init()` lanza y el
 * proveedor degrada a `hash` en silencio — con el catálogo indexado a 512
 * dimensiones, eso es un matching visual que devuelve cero sin dar un error.
 *
 * En Vercel el único directorio escribible es /tmp, y sobrevive entre
 * invocaciones de la MISMA instancia: con Fluid Compute (que reutiliza
 * instancias) el modelo se descarga una vez por instancia, no por petición.
 * Fuera de serverless no se toca nada y sigue usando su caché por defecto,
 * que es lo que hace rápido el reindex por CLI.
 */
function configureModelCache(transformers: any): void {
  if (!process.env.VERCEL) return;
  const dir = "/tmp/transformers-cache";
  try {
    mkdirSync(dir, { recursive: true });
    transformers.env.cacheDir = dir;
  } catch (err) {
    logger.warn("embeddings: no se pudo preparar la caché del modelo", {
      dir,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/* ------------------------------- factory ------------------------------- */

let activeProvider: EmbeddingProvider | null = null;

/**
 * Inicialización EN VUELO, memoizada.
 *
 * Sin esto, `getEmbeddingProvider` tenía una carrera clásica: la guarda
 * `if (activeProvider)` se evalúa, el `await local.init()` cede el control, y
 * cualquier llamada que entre mientras tanto vuelve a pasar la guarda y carga
 * otro CLIP. Medido con el matching a concurrencia 3: el modelo (~90 MB ONNX)
 * se cargaba TRES veces y el embedding del primer crop pasaba de ~500 ms a
 * 5.400 ms. No fallaba nada — solo era tres veces más lento y tres veces más
 * memoria, que es la clase de defecto que no se ve sin medir.
 */
let providerInFlight: Promise<EmbeddingProvider> | null = null;

/** Último motivo por el que NO se usó CLIP. Lo lee `embeddingDiagnostics()`. */
let lastLocalError: string | null = null;

/**
 * Devuelve el provider activo. Si CATALOG_IMAGE_EMBEDDING_PROVIDER=local pero
 * transformers no está disponible (no instalado / sin red para el modelo),
 * degradamos a hash y lo dejamos registrado — nunca rompemos el arranque.
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (activeProvider) return activeProvider;
  providerInFlight ??= initEmbeddingProvider().finally(() => {
    providerInFlight = null;
  });
  return providerInFlight;
}

async function initEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (activeProvider) return activeProvider;
  const config = getConfig();
  if (config.imageEmbeddingProvider === "local") {
    try {
      const local = new LocalEmbeddingProvider(config.imageEmbeddingModel);
      await local.init();
      // Calentamos con un píxel para fijar la dimensión real del modelo
      const px = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 128, g: 128, b: 128 } },
      }).png().toBuffer();
      await local.embedImage(px);
      activeProvider = local;
      recordProviderUsage(`embeddings:local:${config.imageEmbeddingModel}`, true);
      logger.info("embeddings: provider local activo", {
        model: config.imageEmbeddingModel,
        dimension: local.dimension(),
      });
      return activeProvider;
    } catch (err) {
      recordProviderUsage(`embeddings:local:${config.imageEmbeddingModel}`, false);
      lastLocalError = err instanceof Error ? err.message : String(err);
      logger.warn("embeddings: provider local no disponible, degradando a hash", {
        error: lastLocalError,
      });
    }
  } else {
    lastLocalError = `no solicitado (CATALOG_EMBEDDING_PROVIDER=${JSON.stringify(
      process.env.CATALOG_IMAGE_EMBEDDING_PROVIDER ??
        process.env.CATALOG_EMBEDDING_PROVIDER ??
        null
    )})`;
  }
  activeProvider = new HashEmbeddingProvider();
  return activeProvider;
}

/**
 * Por qué el provider activo es el que es.
 *
 * Existe porque diagnosticar esto por logs es inviable en serverless: la
 * instancia recibe SIGTERM en cuanto responde y el precalentado del modelo
 * (que es `void import(...)`, sin await) muere antes de escribir nada. Sin
 * esto, un CLIP que no carga es indistinguible de uno que sí: el matching
 * simplemente devuelve cero, porque `matchProducts` descarta en silencio los
 * vectores de dimensión distinta.
 */
export function embeddingDiagnostics(): {
  provider: string | null;
  dimension: number | null;
  requested: string | null;
  lastLocalError: string | null;
} {
  return {
    provider: activeProvider?.name ?? null,
    dimension: activeProvider?.dimension() ?? null,
    requested:
      process.env.CATALOG_IMAGE_EMBEDDING_PROVIDER ??
      process.env.CATALOG_EMBEDDING_PROVIDER ??
      null,
    lastLocalError,
  };
}

/** Solo para tests: resetea el provider cacheado. */
export function resetEmbeddingProvider(): void {
  activeProvider = null;
  providerInFlight = null;
}
