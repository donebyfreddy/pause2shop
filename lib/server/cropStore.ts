/**
 * Almacén EFÍMERO de crops en memoria del servidor, servidos por
 * GET /api/crops/[hash]. Es el proveedor `local` del adaptador de media
 * (lib/mediaStorage): Google Lens exige una URL pública y la propia
 * app puede servir el crop si su origen es alcanzable desde Internet
 * (deploy en Vercel / túnel). En localhost no sirve — los proveedores no
 * pueden descargar de 127.0.0.1 — y se detecta para no gastar créditos.
 */

type StoredCrop = { buffer: Buffer; mime: string; expiresAt: number };

const TTL_MS = Number(process.env.CROP_STORE_TTL_MS) || 15 * 60 * 1000;
const MAX_ENTRIES = 200;

const globalStore = globalThis as unknown as {
  __cropStore?: Map<string, StoredCrop>;
};

function store(): Map<string, StoredCrop> {
  globalStore.__cropStore ??= new Map();
  return globalStore.__cropStore;
}

export function putCrop(hash: string, buffer: Buffer, mime: string): void {
  const s = store();
  // Purga simple: caducados primero, luego el más antiguo si sigue lleno.
  const now = Date.now();
  for (const [k, v] of s) if (v.expiresAt < now) s.delete(k);
  while (s.size >= MAX_ENTRIES) {
    const first = s.keys().next().value;
    if (!first) break;
    s.delete(first);
  }
  s.set(hash, { buffer, mime, expiresAt: now + TTL_MS });
}

export function getCrop(hash: string): { buffer: Buffer; mime: string } | null {
  const entry = store().get(hash);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store().delete(hash);
    return null;
  }
  return { buffer: entry.buffer, mime: entry.mime };
}

/** ¿Este origen es alcanzable por un proveedor externo? */
export function isPubliclyReachable(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return !(
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

/**
 * Publica el crop en el almacén local y devuelve su URL pública, o null si
 * el origen no es alcanzable desde Internet (localhost/red privada).
 * `PUBLIC_MEDIA_BASE_URL` tiene prioridad sobre el origen de la petición.
 */
export function publishCropLocally(
  hash: string,
  buffer: Buffer,
  mime: string,
  requestOrigin: string
): string | null {
  const base = process.env.PUBLIC_MEDIA_BASE_URL?.trim() || requestOrigin;
  if (!isPubliclyReachable(base)) return null;
  putCrop(hash, buffer, mime);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return `${base.replace(/\/$/, "")}/api/crops/${hash}.${ext}`;
}
