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

class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local" as const;
  readonly model: string;
  private dim = 0;
  private imagePipeline: any = null;
  /** Tokenizador y torre de TEXTO de CLIP, cargados aparte del de imagen. */
  private tokenizer: any = null;
  private textModel: any = null;

  constructor(model: string) {
    this.model = model;
  }

  async init(): Promise<void> {
    // Import dinámico: el paquete puede no estar instalado (es opcional).
    const transformers: any = await optionalTransformersImport();
    this.imagePipeline = await transformers.pipeline("image-feature-extraction", this.model);

    // Torre de texto: tokenizador + CLIPTextModelWithProjection, NO un pipeline
    // de "feature-extraction" sobre el modelo completo.
    //
    // Esto estaba mal y no se notaba: `pipeline("feature-extraction", clip)`
    // carga el modelo CLIP ENTERO, que exige `input_ids` Y `pixel_values`.
    // Construirlo funciona, así que el try/catch de aquí no cazaba nada; la
    // llamada reventaba después con "Missing the following inputs:
    // pixel_values". El único camino que llama a embedText es el reindex, que
    // por eso terminaba con 3 errores y sin actualizar nada.
    //
    // La torre de texto devuelve 512 dimensiones — el MISMO espacio que las
    // imágenes—, así que además habilita buscar imágenes por texto.
    try {
      this.tokenizer = await transformers.AutoTokenizer.from_pretrained(this.model);
      this.textModel = await transformers.CLIPTextModelWithProjection.from_pretrained(
        this.model
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
 */
function optionalTransformersImport(): Promise<any> {
  const runtimeImport = new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<any>;
  return runtimeImport("@huggingface/transformers");
}

/* ------------------------------- factory ------------------------------- */

let activeProvider: EmbeddingProvider | null = null;

/**
 * Devuelve el provider activo. Si CATALOG_IMAGE_EMBEDDING_PROVIDER=local pero
 * transformers no está disponible (no instalado / sin red para el modelo),
 * degradamos a hash y lo dejamos registrado — nunca rompemos el arranque.
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
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
      logger.warn("embeddings: provider local no disponible, degradando a hash", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  activeProvider = new HashEmbeddingProvider();
  return activeProvider;
}

/** Solo para tests: resetea el provider cacheado. */
export function resetEmbeddingProvider(): void {
  activeProvider = null;
}
