/**
 * Adaptador de almacenamiento de media pública.
 *
 * ¿Por qué existe esto? Google Lens (vía SearchAPI o SerpAPI) exige una URL
 * PÚBLICA de la imagen: no acepta base64. Así que un frame o un crop que
 * queramos buscar hay que publicarlo en algún sitio alcanzable desde Internet
 * antes de llamar al proveedor.
 *
 * Antes ese "algún sitio" era Supabase Storage, cableado a pelo contra su API
 * REST. Ahora es este adaptador: el motor de búsqueda visual pide "publica
 * este buffer y dame una URL" y no sabe ni le importa quién lo sirve.
 *
 * REGLA QUE NO SE ROMPE: los binarios NUNCA se guardan en Postgres. Supabase cobra
 * por almacenamiento y por transferencia, los blobs revientan los backups y una
 * fila de varios MB destroza el rendimiento de cualquier `select *` que la
 * toque. En la base de datos van la URL y el hash; los píxeles, fuera.
 *
 * Proveedores:
 *   · local (por defecto) — sirve el objeto desde la propia app en
 *     /api/crops/[hash], con TTL y en memoria. Es el mock de desarrollo y
 *     además el fallback real en producción cuando el deploy es alcanzable
 *     (Vercel). En localhost no funciona a propósito: un proveedor externo no
 *     puede descargar de 127.0.0.1, y lo detectamos para no gastar créditos.
 *   · vercel_blob — almacenamiento persistente real. Es el único proveedor
 *     apto para el catálogo: las URLs no caducan y sobreviven a los cold
 *     starts, cosa que `local` no hace. Requiere BLOB_READ_WRITE_TOKEN.
 *   · s3 | r2 — NO IMPLEMENTADOS. Están declarados para que el día que se
 *     necesiten haya un sitio evidente donde ponerlos, y para que configurar
 *     STORAGE_PROVIDER=s3 falle con un mensaje claro en vez de caer en
 *     silencio al local y dejar a alguien preguntándose por qué sus imágenes
 *     caducan a los 15 minutos.
 */
import {
  isPubliclyReachable,
  publishCropLocally,
} from "@/lib/server/cropStore";
import { blobPut, blobTokenPresent } from "./vercelBlob";

export type StorageProviderId = "local" | "s3" | "r2" | "vercel_blob";

const IMPLEMENTED: readonly StorageProviderId[] = ["local", "vercel_blob"];

/** Proveedores cuyos objetos sobreviven a un reinicio del proceso. */
const PERSISTENT: readonly StorageProviderId[] = ["vercel_blob", "s3", "r2"];

export type PublishResult =
  | {
      ok: true;
      url: string;
      provider: StorageProviderId;
      /**
       * El objeto ya estaba publicado y no se resubió. Lo usa el importador de
       * datasets para contar cuántas imágenes se ahorró al reanudar; sin esto,
       * una reimportación completa parecería haber subido 1.000 imágenes que en
       * realidad ya estaban.
       */
      alreadyExisted?: boolean;
    }
  | { ok: false; reason: string };

export type StorageConfig = {
  provider: StorageProviderId;
  /** Prefijo/bucket lógico. En `local` solo entra en la clave del objeto. */
  bucket: string;
  /**
   * Base pública desde la que se sirve el media. Si no se define, el proveedor
   * `local` usa el origen de la petición en curso.
   */
  publicBaseUrl: string | null;
};

function parseProvider(raw: string | undefined): StorageProviderId {
  const value = raw?.trim().toLowerCase();
  if (!value) return "local";
  // `supabase` se acepta y se remapea a `local` en vez de reventar: hay
  // entornos con la variable antigua puesta y no queremos que un deploy caiga
  // por eso. Se avisa una vez para que alguien la limpie.
  if (value === "supabase") {
    warnOnce(
      "[storage] STORAGE_PROVIDER=supabase ya no existe: se usa el proveedor " +
        "`local`. Quita la variable o ponla a `local`."
    );
    return "local";
  }
  if ((IMPLEMENTED as readonly string[]).includes(value)) {
    return value as StorageProviderId;
  }
  if (["s3", "r2"].includes(value)) {
    return value as StorageProviderId;
  }
  warnOnce(
    `[storage] STORAGE_PROVIDER="${value}" no reconocido: se usa \`local\`.`
  );
  return "local";
}

const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

export function getStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): StorageConfig {
  return {
    provider: parseProvider(env.STORAGE_PROVIDER),
    bucket: env.STORAGE_BUCKET?.trim() || "frames",
    publicBaseUrl: env.PUBLIC_MEDIA_BASE_URL?.trim() || null,
  };
}

/** ¿El proveedor configurado está realmente implementado? */
export function isStorageConfigured(config = getStorageConfig()): boolean {
  if (!IMPLEMENTED.includes(config.provider)) return false;
  // Estar implementado no basta: sin token, `vercel_blob` no puede subir nada.
  if (config.provider === "vercel_blob") return blobTokenPresent();
  return true;
}

/**
 * ¿Los objetos publicados sobreviven a un reinicio? El catálogo lo exige: una
 * ficha cuya imagen caduca a los 15 minutos no es un catálogo.
 */
export function isPersistentStorage(config = getStorageConfig()): boolean {
  return PERSISTENT.includes(config.provider) && isStorageConfigured(config);
}

/**
 * ¿Esta base pública es alcanzable por un proveedor externo? Reexportado desde
 * cropStore para que los consumidores del adaptador no tengan que saber que la
 * comprobación vive allí.
 */
export function isPubliclyReachableBase(base: string): boolean {
  return isPubliclyReachable(base);
}

export function extensionForMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Publica un objeto y devuelve su URL pública.
 *
 * `hash` (sha256 del contenido) hace de nombre: la publicación es idempotente
 * y no enumerable. `requestOrigin` solo lo usa el proveedor `local`, que sirve
 * desde la propia app y por tanto necesita saber en qué origen está.
 */
export async function publishPublicObject(options: {
  hash: string;
  buffer: Buffer;
  mime: string;
  /** Carpeta lógica: "frames" (frame completo) o "crops" (recorte). */
  prefix?: "frames" | "crops";
  /**
   * Clave explícita del objeto. Cuando se pasa, manda sobre `hash`/`prefix`:
   * el catálogo necesita rutas estables y legibles
   * (`catalog/datasets/<dataset>/<id>.jpg`) y no un hash opaco, para poder
   * localizar y borrar los objetos de un dataset concreto.
   */
  pathname?: string;
  requestOrigin?: string | null;
  config?: StorageConfig;
}): Promise<PublishResult> {
  const config = options.config ?? getStorageConfig();
  const { hash, buffer, mime } = options;

  if (!IMPLEMENTED.includes(config.provider)) {
    return {
      ok: false,
      reason:
        `El proveedor de storage "${config.provider}" está declarado pero no ` +
        `implementado. Proveedores disponibles: ${IMPLEMENTED.join(", ")}.`,
    };
  }

  if (config.provider === "vercel_blob") {
    const pathname =
      options.pathname ??
      `${config.bucket}/${options.prefix ?? "frames"}/${hash}.${extensionForMime(mime)}`;
    const result = await blobPut({ pathname, buffer, contentType: mime });
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      url: result.url,
      provider: "vercel_blob",
      alreadyExisted: result.alreadyExisted,
    };
  }

  const base = config.publicBaseUrl ?? options.requestOrigin ?? null;
  if (!base) {
    return {
      ok: false,
      reason:
        "El proveedor `local` necesita una base pública: define " +
        "PUBLIC_MEDIA_BASE_URL o publica desde un route handler que aporte el " +
        "origen de la petición.",
    };
  }
  if (!isPubliclyReachable(base)) {
    return {
      ok: false,
      reason:
        `"${base}" no es alcanzable desde Internet (localhost o red privada), ` +
        "así que un proveedor externo no podría descargar la imagen. En local, " +
        "expón la app con un túnel o define PUBLIC_MEDIA_BASE_URL.",
    };
  }

  const url = publishCropLocally(hash, buffer, mime, base);
  if (!url) {
    return { ok: false, reason: "El almacén local rechazó la publicación." };
  }
  return { ok: true, url, provider: "local" };
}

/**
 * Estado del storage para /api/health/storage y el diagnóstico de la demo.
 * Nunca devuelve credenciales — el proveedor `local` no tiene ninguna, y ese
 * es parte de su atractivo para desarrollo.
 */
export function describeStorage(config = getStorageConfig()): {
  provider: StorageProviderId;
  implemented: boolean;
  bucket: string;
  publicBaseUrl: string | null;
  /** El `local` es efímero: TTL en memoria, se pierde al reiniciar. */
  ephemeral: boolean;
} {
  return {
    provider: config.provider,
    implemented: IMPLEMENTED.includes(config.provider),
    bucket: config.bucket,
    publicBaseUrl: config.publicBaseUrl,
    ephemeral: !isPersistentStorage(config),
  };
}
