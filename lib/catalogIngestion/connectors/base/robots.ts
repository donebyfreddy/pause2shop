/**
 * Parser simple de robots.txt. No cubre el 100% del RFC 9309, pero sí lo que
 * necesitamos para ser buenos ciudadanos: grupos por User-agent, Allow/Disallow
 * con prefijos, comodín `*` y `$`, y Crawl-delay. En caso de duda (robots
 * ilegible) somos conservadores solo ante un Disallow explícito; un robots
 * inaccesible por error de red se trata como "permitido" (comportamiento
 * estándar de los crawlers educados cuando el 4xx indica ausencia de fichero).
 */

export interface RobotsRules {
  allows: string[];
  disallows: string[];
  crawlDelaySeconds: number | null;
  /** Directivas `Sitemap:` (globales, no pertenecen a ningún grupo de UA). */
  sitemaps: string[];
  /**
   * Cómo se obtuvo este robots.txt. Importa porque un fichero ausente y un
   * fichero DENEGADO no significan lo mismo, y tratarlos igual produce
   * diagnósticos falsos: la fuente sale "permitida, 0 productos" cuando la
   * realidad es que el edge nos está bloqueando.
   *
   *  · `fetched`     → 2xx: reglas reales.
   *  · `absent`      → 404/410: no hay robots.txt, se puede rastrear.
   *  · `denied`      → 401/403/429: nos están negando el acceso.
   *  · `unreachable` → 5xx, timeout o error de red.
   */
  outcome: RobotsOutcome;
  /** Código HTTP observado, si hubo respuesta. */
  status: number | null;
}

export type RobotsOutcome = "fetched" | "absent" | "denied" | "unreachable";

/**
 * ¿Este resultado permite rastrear el dominio?
 *
 * Solo `denied` (401/403/429) dice NO, y dice NO de forma rotunda: si el
 * servidor nos niega hasta `/robots.txt`, seguir pidiendo el resto de URLs es
 * insistir después de un no. Ese es el caso de Zara y Mango desde una IP de
 * datacenter, y el que antes se reportaba como "permitido".
 *
 * `unreachable` (5xx, timeout, DNS) NO bloquea a propósito. Es ambiguo — un
 * corte de red nuestro no es una política del dominio — y tratarlo como
 * prohibición dejaría el scraper parado ante cualquier hipo transitorio. Se
 * registra como aviso y el rate limit conservador nos mantiene educados.
 */
export function robotsAllowsCrawling(rules: RobotsRules): boolean {
  return rules.outcome !== "denied";
}

/** Clasifica una respuesta de robots.txt. */
export function classifyRobotsStatus(status: number): RobotsOutcome {
  if (status >= 200 && status < 300) return "fetched";
  if (status === 401 || status === 403 || status === 429) return "denied";
  if (status >= 500) return "unreachable";
  return "absent";
}

/** Reglas vacías con un desenlace concreto. */
export function emptyRobots(outcome: RobotsOutcome, status: number | null): RobotsRules {
  return {
    allows: [],
    disallows: [],
    crawlDelaySeconds: null,
    sitemaps: [],
    outcome,
    status,
  };
}

export function parseRobots(content: string, userAgent: string): RobotsRules {
  const uaToken = userAgent.split("/")[0].toLowerCase();
  const groups: Array<{ agents: string[]; allows: string[]; disallows: string[]; crawlDelay: number | null }> = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "sitemap") {
      // `Sitemap:` es global: nos vale para descubrir catálogo sin adivinar URLs.
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      // Varias líneas User-agent seguidas comparten grupo
      if (!lastWasAgent || !current) {
        current = { agents: [], allows: [], disallows: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow" && value) current.disallows.push(value);
    if (field === "allow" && value) current.allows.push(value);
    if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }

  // Grupo más específico para nuestro UA; si no hay, el grupo `*`
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && uaToken.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const group = specific ?? wildcard;
  return {
    allows: group?.allows ?? [],
    disallows: group?.disallows ?? [],
    crawlDelaySeconds: group?.crawlDelay ?? null,
    sitemaps,
    outcome: "fetched",
    status: 200,
  };
}

/** ¿Coincide una ruta con un patrón de robots (soporta `*` y `$`)? */
function matchesPattern(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\$$/, "$")
    .replace(/\*/g, ".*");
  const anchored = escaped.endsWith("$") ? `^${escaped}` : `^${escaped}`;
  return new RegExp(anchored).test(path);
}

/** Regla más larga gana (estándar de Google): Allow específico vence a Disallow genérico. */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const a of rules.allows) if (matchesPattern(path, a)) bestAllow = Math.max(bestAllow, a.length);
  for (const d of rules.disallows) if (matchesPattern(path, d)) bestDisallow = Math.max(bestDisallow, d.length);
  return bestAllow >= bestDisallow;
}
