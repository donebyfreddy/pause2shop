/**
 * Validación de variables de entorno del servidor SIN exponer valores.
 *
 * Cada variable se reporta con un `status` y, como mucho, con una pista de
 * *forma* (p.ej. "empieza por postgres://", "es un JWT eyJ…"). NUNCA se
 * devuelve, imprime ni loguea el valor real de un secreto.
 */

export type EnvStatus =
  | "ok"
  | "configured" // presente y con forma válida, sin comprobación de red
  | "invalid_format"
  | "missing"
  | "placeholder";

export type EnvCheck = {
  name: string;
  status: EnvStatus;
  /** Pista de forma, nunca el valor. */
  hint?: string;
  /** true si esta variable es imprescindible para el arranque. */
  required: boolean;
};

const PLACEHOLDER_PATTERNS = [
  /^your[-_]/i,
  /^changeme$/i,
  /^xxx+$/i,
  /^<.*>$/,
  /^replace[-_]/i,
  /^todo$/i,
  /^example/i,
];

function raw(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  return v;
}

function isPlaceholder(v: string): boolean {
  const t = v.trim();
  if (!t) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

/** Detecta espacios/comillas/saltos de línea envolventes (error común de copiado). */
function hasWrappingJunk(v: string): boolean {
  return (
    v !== v.trim() ||
    /^["'].*["']$/.test(v.trim()) ||
    /[\r\n]/.test(v)
  );
}

function present(
  name: string,
  required: boolean,
  validate: (v: string) => { status: EnvStatus; hint?: string },
): EnvCheck {
  const v = raw(name);
  if (v == null || v.trim() === "") {
    return { name, status: "missing", required };
  }
  if (isPlaceholder(v)) {
    return { name, status: "placeholder", hint: "valor de ejemplo/placeholder", required };
  }
  if (hasWrappingJunk(v)) {
    return {
      name,
      status: "invalid_format",
      hint: "espacios, comillas o saltos de línea sobrantes",
      required,
    };
  }
  return { ...validate(v.trim()), name, required };
}

function ok(hint?: string): { status: EnvStatus; hint?: string } {
  return { status: "ok", hint };
}
function configured(hint?: string): { status: EnvStatus; hint?: string } {
  return { status: "configured", hint };
}
function invalid(hint: string): { status: EnvStatus; hint?: string } {
  return { status: "invalid_format", hint };
}

/**
 * Forma del endpoint de Postgres, sin revelar la connection string. Lo que
 * importa operativamente es si apunta al pooler: con el endpoint directo de
 * Supabase (IPv6-only salvo add-on de IPv4), cada invocación serverless abre
 * su propia conexión y se agota el límite del proyecto en cuanto hay algo de
 * tráfico.
 */
function describePostgresHost(v: string): string {
  try {
    const host = new URL(v).hostname;
    if (host.endsWith(".pooler.supabase.com")) {
      return "Supabase, Transaction pooler (correcto para serverless)";
    }
    if (host.endsWith(".supabase.co")) {
      return "Supabase, conexión DIRECTA — usa el Transaction pooler en serverless";
    }
    return "postgres://… (host propio)";
  } catch {
    return "postgres://…";
  }
}

export function validateServerEnv(): EnvCheck[] {
  const checks: EnvCheck[] = [];

  checks.push(
    present("OPENAI_API_KEY", true, (v) =>
      v.startsWith("sk-") ? ok("sk-…") : invalid("debería empezar por sk-"),
    ),
  );
  checks.push(present("VISION_MODEL", false, () => configured()));

  // DATABASE_URL: DEBE ser postgres:// / postgresql:// — nunca una URL HTTP.
  // Es la ÚNICA fuente de la conexión (Supabase). No hay variante
  // NEXT_PUBLIC_ a propósito: la connection string lleva la contraseña y no
  // puede salir al navegador bajo ninguna circunstancia.
  checks.push(
    present("DATABASE_URL", true, (v) => {
      if (/^postgres(ql)?:\/\//.test(v)) return ok(describePostgresHost(v));
      if (/^https?:\/\//.test(v))
        return invalid("es una URL HTTP — se necesita postgres://");
      return invalid("no empieza por postgres://");
    }),
  );

  checks.push(present("SEARCHAPI_API_KEY", false, () => configured()));
  checks.push(present("SERPAPI_API_KEY", false, () => configured()));
  checks.push(present("DATAFORSEO_USERNAME", false, () => configured()));
  checks.push(present("DATAFORSEO_PASSWORD", false, () => configured()));

  // Sin definir → `local` (ver lib/mediaStorage). Los demás están declarados
  // pero sin implementar: se marcan como inválidos para que nadie los configure
  // creyendo que funcionan.
  checks.push(
    present("STORAGE_PROVIDER", false, (v) =>
      v === "local"
        ? ok("local (la app sirve el media en /api/crops/[hash])")
        : invalid(`"${v}" declarado pero no implementado — usa "local"`),
    ),
  );
  checks.push(present("STORAGE_BUCKET", false, () => configured()));
  checks.push(
    present("PUBLIC_MEDIA_BASE_URL", false, (v) =>
      /^https:\/\//.test(v)
        ? ok(v)
        : invalid("debe ser una URL https:// alcanzable desde Internet"),
    ),
  );

  return checks;
}

/** Resumen booleano para health-checks (sin valores). */
export function envSummary() {
  const checks = validateServerEnv();
  const byName = Object.fromEntries(checks.map((c) => [c.name, c.status]));
  const missingRequired = checks.filter(
    (c) => c.required && (c.status === "missing" || c.status === "invalid_format" || c.status === "placeholder"),
  );
  return { checks, byName, ok: missingRequired.length === 0, missingRequired };
}
