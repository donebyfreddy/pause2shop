/**
 * Driver de Vercel Blob para el adaptador de media.
 *
 * ¿Por qué se implementa ahora? El proveedor `local` sirve desde memoria con
 * TTL de 15 minutos y las imágenes del catálogo iban a `os.tmpdir()`, que en
 * serverless se borra en cada cold start. Eso hacía que `reindex_embeddings`
 * no encontrara ninguna imagen y que una ficha importada perdiera su foto sin
 * avisar. Para un catálogo persistente hace falta almacenamiento persistente.
 *
 * El SDK se importa de forma perezosa y dentro de un try: `@vercel/blob` solo
 * hace falta cuando STORAGE_PROVIDER=vercel_blob, y no queremos que el bundle
 * del cliente ni un entorno sin la dependencia se caigan por un import fijo.
 */

export type BlobPutResult =
  | { ok: true; url: string; alreadyExisted: boolean }
  | { ok: false; reason: string };

type BlobModule = {
  put: (
    pathname: string,
    body: Buffer,
    options: Record<string, unknown>
  ) => Promise<{ url: string; pathname: string }>;
  head: (
    urlOrPathname: string,
    options?: Record<string, unknown>
  ) => Promise<{ url: string; size: number }>;
  del: (urlOrPathname: string | string[], options?: Record<string, unknown>) => Promise<void>;
  list: (options?: Record<string, unknown>) => Promise<{
    blobs: Array<{ url: string; pathname: string; size: number }>;
    cursor?: string;
    hasMore: boolean;
  }>;
};

let cached: BlobModule | null = null;

async function loadBlob(): Promise<BlobModule | null> {
  if (cached) return cached;
  try {
    const mod = (await import("@vercel/blob")) as unknown as BlobModule;
    cached = mod;
    return mod;
  } catch {
    return null;
  }
}

export function blobTokenPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * ¿Existe ya este objeto? Se usa para no resubir una imagen que ya está: el
 * importador es reanudable y repetirlo mil veces no debe costar mil PUTs.
 *
 * Un fallo de red devuelve `null` (desconocido) y no `false`, para que quien
 * llame pueda distinguir "no está" de "no he podido comprobarlo".
 */
export async function blobHead(
  pathname: string
): Promise<{ url: string; size: number } | null> {
  const blob = await loadBlob();
  if (!blob) return null;
  try {
    return await blob.head(pathname);
  } catch {
    return null;
  }
}

/**
 * Sube un objeto con un pathname determinista (sin sufijo aleatorio) para que
 * la misma imagen dé siempre la misma URL. `skipIfExists` evita el PUT cuando
 * ya está, que es el caso normal al reanudar una importación.
 */
export async function blobPut(options: {
  pathname: string;
  buffer: Buffer;
  contentType: string;
  skipIfExists?: boolean;
}): Promise<BlobPutResult> {
  const blob = await loadBlob();
  if (!blob) {
    return {
      ok: false,
      reason:
        "El paquete `@vercel/blob` no está instalado. Ejecuta " +
        "`npm install @vercel/blob` o cambia STORAGE_PROVIDER.",
    };
  }
  if (!blobTokenPresent()) {
    return {
      ok: false,
      reason:
        "Falta BLOB_READ_WRITE_TOKEN. Crea un store con " +
        "`vercel blob create-store <nombre> --access public` y ejecuta " +
        "`vercel env pull .env.local`.",
    };
  }

  if (options.skipIfExists !== false) {
    const existing = await blobHead(options.pathname);
    if (existing) return { ok: true, url: existing.url, alreadyExisted: true };
  }

  try {
    const result = await blob.put(options.pathname, options.buffer, {
      access: "public",
      contentType: options.contentType,
      // Sin sufijo aleatorio: el pathname ES la identidad del objeto.
      addRandomSuffix: false,
      // Reimportar la misma ficha debe poder pisar la imagen anterior.
      allowOverwrite: true,
      // Las imágenes de dataset son inmutables: cachea agresivamente.
      cacheControlMaxAge: 31_536_000,
    });
    return { ok: true, url: result.url, alreadyExisted: false };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Borra objetos por URL o pathname. Usado por `catalog:dataset:cleanup`. */
export async function blobDelete(urlsOrPathnames: string[]): Promise<number> {
  const blob = await loadBlob();
  if (!blob || urlsOrPathnames.length === 0 || !blobTokenPresent()) return 0;
  // El SDK admite lotes, pero un solo elemento inválido tumbaría el lote
  // entero. Se trocea para que un borrado parcial siga avanzando.
  let deleted = 0;
  const CHUNK = 100;
  for (let i = 0; i < urlsOrPathnames.length; i += CHUNK) {
    const chunk = urlsOrPathnames.slice(i, i + CHUNK);
    try {
      await blob.del(chunk);
      deleted += chunk.length;
    } catch {
      // Reintento uno a uno para no perder los válidos del lote.
      for (const one of chunk) {
        try {
          await blob.del(one);
          deleted += 1;
        } catch {
          /* se ignora: el cleanup es best-effort */
        }
      }
    }
  }
  return deleted;
}

/** Lista objetos bajo un prefijo, paginando hasta agotarlos. */
export async function blobList(
  prefix: string
): Promise<Array<{ url: string; pathname: string; size: number }>> {
  const blob = await loadBlob();
  if (!blob || !blobTokenPresent()) return [];
  const out: Array<{ url: string; pathname: string; size: number }> = [];
  let cursor: string | undefined;
  do {
    const page = await blob.list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}
