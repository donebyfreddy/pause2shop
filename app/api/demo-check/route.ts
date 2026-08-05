import { NextResponse } from "next/server";
import { getPool, isDatabaseConfigured } from "@/lib/db/pool";
import { getPersistenceMode } from "@/lib/catalog";
import { describeStorage, isPubliclyReachableBase } from "@/lib/mediaStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/demo-check — preflight de la demo.
 * Comprueba cada dependencia externa con timeout corto y devuelve estado,
 * latencia y acción recomendada. NUNCA devuelve valores de claves.
 */

export type CheckStatus = "ok" | "warning" | "error";

export type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  latencyMs: number | null;
  detail: string;
  action?: string;
};

const CHECK_TIMEOUT_MS = 8_000;

function timed(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
}

async function checkOpenAI(): Promise<CheckResult> {
  const base = { id: "openai", label: "OpenAI (visión)" };
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      ...base,
      status: "error",
      latencyMs: null,
      detail: "OPENAI_API_KEY no configurada — la visión funcionará en modo mock.",
      action: "Añade OPENAI_API_KEY al entorno.",
    };
  }
  const lap = timed();
  try {
    const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      return { ...base, status: "ok", latencyMs: lap(), detail: "Clave válida." };
    }
    return {
      ...base,
      status: "error",
      latencyMs: lap(),
      detail: `OpenAI respondió ${res.status}.`,
      action: res.status === 401 ? "La clave es inválida: renuévala." : "Revisa el estado de OpenAI.",
    };
  } catch {
    return {
      ...base,
      status: "error",
      latencyMs: lap(),
      detail: "No se pudo contactar con OpenAI (timeout/red).",
      action: "Revisa la conexión a internet.",
    };
  }
}

async function checkSearchApi(): Promise<CheckResult> {
  const base = { id: "searchapi", label: "SearchAPI (Google Lens)" };
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key) {
    return {
      ...base,
      status: "warning",
      latencyMs: null,
      detail:
        "SEARCHAPI_API_KEY no configurada — sin búsqueda visual inversa (Lens).",
      action: "Crea una clave en searchapi.io y añádela como SEARCHAPI_API_KEY.",
    };
  }
  const lap = timed();
  try {
    // Petición sin `q`: si la clave es válida devuelve 400 (falta parámetro);
    // si es inválida devuelve 401. No consume búsquedas.
    const res = await fetchWithTimeout(
      "https://www.searchapi.io/api/v1/search?engine=google",
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (res.status === 401 || res.status === 403) {
      return {
        ...base,
        status: "error",
        latencyMs: lap(),
        detail: "Clave de SearchAPI inválida.",
        action: "Regenera la clave en searchapi.io.",
      };
    }
    return { ...base, status: "ok", latencyMs: lap(), detail: "Clave aceptada." };
  } catch {
    return {
      ...base,
      status: "error",
      latencyMs: lap(),
      detail: "No se pudo contactar con SearchAPI.",
    };
  }
}

async function checkSerpApi(): Promise<CheckResult> {
  const base = { id: "serpapi", label: "SerpAPI (Lens fallback + Shopping)" };
  const key = process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY;
  if (!key) {
    return {
      ...base,
      status: "warning",
      latencyMs: null,
      detail: "SERPAPI_API_KEY no configurada (proveedor opcional).",
    };
  }
  const lap = timed();
  try {
    const res = await fetchWithTimeout(
      `https://serpapi.com/account?api_key=${encodeURIComponent(key)}`
    );
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      total_searches_left?: number;
    };
    if (json.error) {
      return {
        ...base,
        status: "error",
        latencyMs: lap(),
        detail: "Clave de SerpAPI inválida.",
        action: "Regenera la clave en serpapi.com o elimínala del entorno.",
      };
    }
    const left = json.total_searches_left;
    return {
      ...base,
      status: left === 0 ? "warning" : "ok",
      latencyMs: lap(),
      detail:
        left != null ? `Cuenta activa (${left} búsquedas restantes).` : "Cuenta activa.",
      action: left === 0 ? "Sin búsquedas restantes: amplía el plan." : undefined,
    };
  } catch {
    return { ...base, status: "error", latencyMs: lap(), detail: "No se pudo contactar con SerpAPI." };
  }
}

async function checkDataForSeo(): Promise<CheckResult> {
  const base = { id: "dataforseo", label: "DataForSEO (Google Shopping)" };
  const user = process.env.DATAFORSEO_USERNAME;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!user || !pass) {
    return {
      ...base,
      status: "warning",
      latencyMs: null,
      detail: "Credenciales de DataForSEO no configuradas.",
    };
  }
  const lap = timed();
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  try {
    // Endpoint de metadatos SIN coste. Si la cuenta no está verificada,
    // DataForSEO devuelve 40104 aquí también.
    const res = await fetchWithTimeout(
      "https://api.dataforseo.com/v3/merchant/google/locations",
      { headers: { Authorization: auth } }
    );
    const json = (await res.json().catch(() => ({}))) as {
      status_code?: number;
      status_message?: string;
    };
    if (json.status_code === 20000) {
      return { ...base, status: "ok", latencyMs: lap(), detail: "Cuenta activa y verificada." };
    }
    if (json.status_code === 40104) {
      return {
        ...base,
        status: "error",
        latencyMs: lap(),
        detail: "La cuenta NO está verificada: todas las búsquedas fallarán.",
        action: "Entra en app.dataforseo.com y completa la verificación de la cuenta.",
      };
    }
    return {
      ...base,
      status: "error",
      latencyMs: lap(),
      detail: `DataForSEO respondió ${json.status_code ?? res.status}: ${json.status_message ?? "error"}.`,
    };
  } catch {
    return { ...base, status: "error", latencyMs: lap(), detail: "No se pudo contactar con DataForSEO." };
  }
}

async function checkDatabase(): Promise<CheckResult> {
  const base = { id: "database", label: "Base de datos (Supabase Postgres)" };
  if (!process.env.DATABASE_URL) {
    return {
      ...base,
      status: "warning",
      latencyMs: null,
      detail: "DATABASE_URL no configurada: catálogo en memoria (se pierde al reiniciar).",
      action: "Opcional para la demo. Copia la connection string del Transaction pooler de Supabase.",
    };
  }
  if (!isDatabaseConfigured()) {
    return {
      ...base,
      status: "warning",
      latencyMs: null,
      detail:
        "DATABASE_URL no es una cadena postgres://. Catálogo en memoria.",
      action: "Cópiala del dashboard de Supabase → Connect → Transaction pooler.",
    };
  }
  const lap = timed();
  try {
    await getPool().query("select 1");
    return { ...base, status: "ok", latencyMs: lap(), detail: "Conexión OK." };
  } catch (err) {
    return {
      ...base,
      status: "warning",
      latencyMs: lap(),
      detail: `DB inaccesible (${err instanceof Error ? err.message : "error"}). La app usa memoria automáticamente.`,
      action: "Comprueba las credenciales y que el proyecto de Supabase exista y no esté pausado.",
    };
  }
}

async function checkMigrations(): Promise<CheckResult> {
  const base = { id: "migrations", label: "Migraciones" };
  if (!isDatabaseConfigured()) {
    return {
      ...base,
      status: "warning",
      latencyMs: null,
      detail: "Sin DB configurada: no aplican migraciones (modo memoria).",
    };
  }
  const lap = timed();
  try {
    const res = await getPool().query<{ count: string }>(
      "select count(*)::text as count from _catalog_migrations"
    );
    const n = Number(res.rows[0]?.count ?? 0);
    // db/migrations tiene 7 ficheros. El umbral estaba en 3 y se quedó atrás:
    // con 4 migraciones sin aplicar el check salía verde y el fallo aparecía
    // luego como "columna inexistente" en mitad de la demo.
    const expected = 7;
    return {
      ...base,
      status: n >= expected ? "ok" : "warning",
      latencyMs: lap(),
      detail: `${n} migraciones aplicadas (se esperan ${expected}).`,
      action: n < expected ? "Ejecuta `npm run db:migrate`." : undefined,
    };
  } catch {
    return {
      ...base,
      status: "warning",
      latencyMs: lap(),
      detail: "No se pudo comprobar la tabla de migraciones.",
      action: "Ejecuta `npm run db:migrate` con la DB accesible.",
    };
  }
}

/**
 * Storage público para los frames que consume Lens. Con el proveedor `local`
 * (el único implementado) no hay credenciales que validar: la app se sirve a sí
 * misma el crop, y lo único que puede fallar es que su origen no sea alcanzable
 * desde Internet — que es exactamente lo que pasa en `localhost`.
 */
function checkStorage(): CheckResult {
  const storage = describeStorage();
  const base = {
    id: "storage",
    label: `Storage público para Lens (${storage.provider})`,
  };

  if (!storage.implemented) {
    return {
      ...base,
      status: "error",
      latencyMs: null,
      detail: `El proveedor "${storage.provider}" está declarado pero no implementado.`,
      action: "Pon STORAGE_PROVIDER=local (o quita la variable).",
    };
  }

  const publicBase = storage.publicBaseUrl;
  if (!publicBase) {
    return {
      ...base,
      status: "warning",
      latencyMs: null,
      detail:
        "Sin PUBLIC_MEDIA_BASE_URL: se usará el origen de cada petición. En " +
        "un deploy público funciona; en localhost, no.",
      action:
        "Para la demo en local, expón la app con un túnel y define PUBLIC_MEDIA_BASE_URL.",
    };
  }

  if (!isPubliclyReachableBase(publicBase)) {
    return {
      ...base,
      status: "error",
      latencyMs: null,
      detail: `"${publicBase}" es localhost o red privada: Lens no podrá descargar el crop.`,
      action: "Usa una URL pública (túnel o deploy) en PUBLIC_MEDIA_BASE_URL.",
    };
  }

  return {
    ...base,
    status: "ok",
    latencyMs: null,
    detail: `Publicación en ${publicBase}/api/crops/… (efímero, TTL en memoria).`,
  };
}

function checkEnvFlags(): CheckResult {
  const enabled: string[] = [];
  const missing: string[] = [];
  const flags: Array<[string, boolean]> = [
    ["ENABLE_VISUAL_SEARCH", process.env.ENABLE_VISUAL_SEARCH !== "false"],
    ["SEARCHAPI_API_KEY", Boolean(process.env.SEARCHAPI_API_KEY)],
    ["SERPAPI_API_KEY", Boolean(process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY)],
    ["DATAFORSEO", Boolean(process.env.DATAFORSEO_USERNAME && process.env.DATAFORSEO_PASSWORD)],
    ["OPENAI_API_KEY", Boolean(process.env.OPENAI_API_KEY)],
    ["DATABASE_URL", Boolean(process.env.DATABASE_URL)],
    ["PUBLIC_MEDIA_BASE_URL", Boolean(process.env.PUBLIC_MEDIA_BASE_URL)],
  ];
  for (const [name, on] of flags) (on ? enabled : missing).push(name);
  return {
    id: "env",
    label: "Variables de entorno",
    status: missing.length === 0 ? "ok" : "warning",
    latencyMs: null,
    detail: `Configuradas: ${enabled.join(", ") || "ninguna"}.${missing.length ? ` Ausentes: ${missing.join(", ")}.` : ""}`,
  };
}

export async function GET(): Promise<NextResponse> {
  const [openai, searchapi, serpapi, dataforseo, database, migrations, storage] =
    await Promise.all([
      checkOpenAI(),
      checkSearchApi(),
      checkSerpApi(),
      checkDataForSeo(),
      checkDatabase(),
      checkMigrations(),
      checkStorage(),
    ]);

  const checks: CheckResult[] = [
    openai,
    searchapi,
    serpapi,
    dataforseo,
    database,
    migrations,
    storage,
    checkEnvFlags(),
    {
      id: "persistence",
      label: "Modo de persistencia actual",
      status: getPersistenceMode() === "postgres" ? "ok" : "warning",
      latencyMs: null,
      detail:
        getPersistenceMode() === "postgres"
          ? "Catálogo persistente en Postgres."
          : "Catálogo en memoria (los resultados sobreviven mientras el servidor no se reinicie).",
    },
  ];

  const worst: CheckStatus = checks.some((c) => c.status === "error")
    ? "error"
    : checks.some((c) => c.status === "warning")
      ? "warning"
      : "ok";

  return NextResponse.json({ ok: true, overall: worst, checks, ranAt: Date.now() });
}
