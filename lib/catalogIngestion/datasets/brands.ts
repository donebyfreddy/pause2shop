/**
 * Extracción de marca desde `productDisplayName`.
 *
 * EL PROBLEMA: el dataset no tiene columna de marca. Solo hay un nombre libre
 * ("Peter England Men Party Blue Jeans"). Es tentador tomar las primeras
 * palabras y llamarlas marca, pero eso produce basura: "Turtle Check Men Navy
 * Blue Shirt" daría la marca "Turtle Check", cuando la marca es "Turtle" y
 * "Check" es el estampado. Una marca inventada es peor que ninguna: filtra mal,
 * agrupa mal y se muestra al usuario como si fuera un dato verificado.
 *
 * LA SOLUCIÓN, en dos partes:
 *
 *  1. Límite estructural. En este dataset el nombre sigue el patrón
 *     `<marca> <género> <resto>`, y el token de género es verificable contra la
 *     columna `gender` de la propia fila. Eso da un candidato con un límite
 *     objetivo, no con una heurística de "las dos primeras palabras".
 *
 *  2. Verificación por frecuencia. El candidato solo se acepta si está en una
 *     lista derivada del propio dataset: se muestrearon 5.600 nombres repartidos
 *     por todo el split y se conservaron los prefijos que aparecen 4 veces o
 *     más. Una marca real se repite decenas de veces; "Turtle Check" aparece una
 *     vez. La lista es reproducible con `scripts/deriveDatasetBrands.ts`.
 *
 * Si el candidato no está en la lista, la marca queda a null. Preferimos un
 * hueco honesto a un dato plausible y falso.
 */

/**
 * Prefijos verificados por frecuencia (>= 4 apariciones en la muestra).
 * Generado con `npm run catalog:dataset:brands` — no editar a mano sin
 * reejecutarlo, o la lista dejará de ser reproducible.
 */
const DERIVED_PREFIXES: readonly string[] = [
  "109F", "ADIDAS", "ADIDAS Originals", "ALayna", "Allen Solly", "Amante",
  "American Tourister", "Aneri", "Angry Birds", "Arrow", "Arrow New York",
  "Arrow Sport", "Aurelia", "Baggit", "Belmonte", "BIBA", "Buckaroo", "Bulchee",
  "Cabarelli", "Calvin Klein", "Carlton London", "Carrera", "Casio",
  "Casio Enticer", "CASIO ENTICER", "Catwalk", "Celine Dion", "Chhota Bheem",
  "Chromozome", "Citizen", "Clarks", "Classic Polo", "Cobblerz", "Colour Me",
  "Converse", "Crocs", "DC Comics", "Denizen", "Disney", "DKNY",
  "Do u speak green", "Do U Speak Green", "Doodle", "DUSG", "Ed Hardy", "Elle",
  "Enamor", "Enroute", "Esprit", "Fabindia", "Facit", "Fastrack", "Femella",
  "FIFA", "Fila", "FILA", "Fiorelli", "Flying Machine", "Folklore",
  "Forever New", "Fossil", "Franco Leone", "French Connection", "Fusion Beats",
  "Ganuchi", "Gas", "Genesis", "Gini and Jony", "Gini Jony", "Giordano",
  "Gliders", "Globalite", "Grendha", "Guess", "Hakashi", "Hanes", "Hidekraft",
  "Highlander", "HM", "Idee", "iPanema", "Inc 5", "Indian Terrain",
  "Indigo Nation", "Inkfruit", "Ivory Tag", "Jack & Jones", "Jealous 21",
  "Jockey", "Jockey COMFORT PLUS", "Jockey ELANCE", "Jockey LCESCBRA",
  "Jockey ZONE", "John Miller", "John Players", "Kiara", "Kraus Jeans",
  "Latin Quarters", "Lee", "Lee Cooper", "Levi's", "Levis", "Lino Perros",
  "Little Miss", "Locomotive", "Lotto", "Lucera", "Madagascar 3 Infant",
  "Madagascar3", "Manchester United", "Mark Taylor", "Marvel", "Maxima",
  "Maxima Ssteele", "Miami Blues", "Mod'acc", "Morellato", "Mother Earth",
  "Mumbai Slang", "Murcia", "Myntra", "Nautica", "New Hide", "Nike",
  "Nike Fragrances", "Numero Uno", "Oakley", "ONLY", "OTLS", "Palm Tree",
  "Park Avenue", "Parx", "Pepe Jeans", "Peperone", "Peri Peri", "Peter England",
  "Pieces", "Playboy", "Polaroid", "Police", "Probase", "Proline", "Provogue",
  "Puma", "Q&Q", "Quechua", "Quiksilver", "Rasasi", "Raymond", "Ray-Ban",
  "Red Chief", "Red Rose", "Red Tape", "Reebok", "Reid & Taylor", "Remanika",
  "Revlon", "Rocia", "Rockport", "Rocky S", "Roxy", "s.Oliver", "Satya Paul",
  "Scullers", "SDL by Sweet Dreams", "Sepia", "Shree", "Skagen",
  "SKAGEN DENMARK", "Skechers", "Spalding", "Spice Art", "Spykar",
  "Status Quo", "Sushilas", "Tantra", "Timberland", "Timex", "Titan",
  "Tokyo Talkies", "Tonga", "ToniQ", "Turtle", "Turtle Solid", "U.S. Polo Assn.",
  "UCB", "Undercolors of Benetton", "United Colors Of Benetton",
  "United Colors of Benetton", "Urban Yoga", "Van Heusen", "Vans", "Vero Moda",
  "Vishudh", "Warner Bros", "Wildcraft", "Wills Lifestyle", "Woodland",
  "Wrangler",
];

/**
 * Prefijos que la frecuencia promueve pero que son palabras genéricas del
 * nombre, no marcas ("Basics Men Blue Shirt"). Se excluyen a mano porque
 * ninguna regla mecánica las distingue de una marca real, y equivocarse aquí
 * significa mostrar una marca falsa. La duda se resuelve siempre a null.
 */
const GENERIC_EXCLUSIONS = new Set(
  [
    "Be", "Basics", "Cat", "Diva", "ID", "Image", "Mr.", "Mr.Men", "Span",
    "Alma", "Aspen", "Campbell", "Coolers", "Estd. 1977", "Estelle", "Guerrilla",
    "Mayhem", "Portia", "Revv", "Senorita", "Spinn", "Tortoise", "York", "Adrika",
    "Biara", "Nyk", "F Sports", "Sepia", "Facit", "Genesis",
  ].map((s) => s.toLowerCase())
);

/**
 * Alias -> forma canónica. Sin esto el catálogo tendría "Levis" y "Levi's" como
 * dos marcas distintas, y filtrar por una perdería la mitad de las fichas.
 */
const CANONICAL: Record<string, string> = {
  "adidas": "Adidas",
  "adidas originals": "Adidas",
  "ucb": "United Colors of Benetton",
  "united colors of benetton": "United Colors of Benetton",
  "undercolors of benetton": "Undercolors of Benetton",
  "levis": "Levi's",
  "levi's": "Levi's",
  "fila": "Fila",
  "gini jony": "Gini and Jony",
  "gini and jony": "Gini and Jony",
  "casio enticer": "Casio",
  "casio": "Casio",
  "skagen denmark": "Skagen",
  "skagen": "Skagen",
  "do u speak green": "Do U Speak Green",
  "do you speak green": "Do U Speak Green",
  "hm": "HM",
  "inc 5": "Inc.5",
  "biba": "Biba",
  "only": "ONLY",
};

/**
 * Marcas independientes que comparten primer token con otra marca de la lista.
 *
 * La poda de abajo colapsa "Jockey ELANCE" en "Jockey" porque es una línea de
 * producto. Pero "Lee Cooper" NO es una línea de Lee: son dos empresas
 * distintas (Lee es estadounidense, Lee Cooper británica). Ninguna regla
 * mecánica distingue los dos casos, así que las excepciones se declaran, con el
 * motivo, y sobreviven a la poda.
 */
const DISTINCT_BRANDS = new Set(["lee cooper"]);

/**
 * Lista efectiva: se poda todo prefijo que contenga a otro más corto ya
 * presente. Así "Jockey ELANCE" o "Turtle Solid" colapsan a "Jockey" y
 * "Turtle" sin mantener a mano un mapa de sub-marcas: la línea de producto se
 * queda fuera de la marca, que es donde debe estar.
 */
function buildAllowlist(): string[] {
  const cleaned = DERIVED_PREFIXES.filter(
    (p) => !GENERIC_EXCLUSIONS.has(p.toLowerCase())
  );
  const byLength = [...cleaned].sort(
    (a, b) => a.split(/\s+/).length - b.split(/\s+/).length
  );
  const kept: string[] = [];
  for (const candidate of byLength) {
    if (DISTINCT_BRANDS.has(candidate.toLowerCase())) {
      kept.push(candidate);
      continue;
    }
    const tokens = candidate.split(/\s+/);
    const hasShorterPrefix = kept.some((k) => {
      const kt = k.split(/\s+/);
      if (kt.length >= tokens.length) return false;
      return kt.every((t, i) => t.toLowerCase() === tokens[i].toLowerCase());
    });
    if (!hasShorterPrefix) kept.push(candidate);
  }
  // Match por el más largo primero: "Lee Cooper" debe ganar a "Lee".
  return kept.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
}

const ALLOWLIST = buildAllowlist();

const LOOKUP = new Map<string, string>(
  ALLOWLIST.map((brand) => [brand.toLowerCase(), CANONICAL[brand.toLowerCase()] ?? brand])
);

/** Tokens que marcan el final de la marca y el inicio de la descripción. */
const GENDER_TOKEN =
  /^(men|mens|men's|women|womens|women's|woman|boys|girls|unisex|kids|kid|baby|infant|for)$/i;

export interface BrandExtraction {
  brand: string | null;
  /** Cómo se resolvió: útil para auditar por qué una ficha no tiene marca. */
  reason: "allowlist" | "no_gender_boundary" | "not_in_allowlist" | "no_title";
  /** Candidato considerado, aunque se haya rechazado. */
  candidate: string | null;
}

/**
 * Extrae la marca SOLO si es defendible. Ver la cabecera del módulo para el
 * razonamiento; el resumen es: límite estructural por token de género +
 * verificación contra lista derivada del dataset. Sin las dos, null.
 */
export function extractBrand(productDisplayName: string | null): BrandExtraction {
  if (!productDisplayName?.trim()) {
    return { brand: null, reason: "no_title", candidate: null };
  }
  const tokens = productDisplayName.trim().split(/\s+/);

  // 1. Coincidencia directa contra la lista (la más larga primero). Cubre los
  //    nombres que no llevan token de género ("Puma Ferrari Cap").
  for (const entry of ALLOWLIST) {
    const entryTokens = entry.split(/\s+/);
    if (entryTokens.length > tokens.length) continue;
    const matches = entryTokens.every(
      (t, i) => t.toLowerCase() === tokens[i].toLowerCase()
    );
    if (matches) {
      return {
        brand: LOOKUP.get(entry.toLowerCase()) ?? entry,
        reason: "allowlist",
        candidate: entry,
      };
    }
  }

  // 2. Sin coincidencia: se localiza el candidato por el límite de género solo
  //    para poder informar de QUÉ se rechazó. No se acepta.
  let cut = -1;
  for (let i = 1; i < Math.min(tokens.length, 5); i += 1) {
    if (GENDER_TOKEN.test(tokens[i])) {
      cut = i;
      break;
    }
  }
  if (cut < 1) {
    return { brand: null, reason: "no_gender_boundary", candidate: null };
  }
  return {
    brand: null,
    reason: "not_in_allowlist",
    candidate: tokens.slice(0, cut).join(" "),
  };
}

/** Para tests y diagnóstico: la lista efectiva tras podar y excluir. */
export function brandAllowlist(): readonly string[] {
  return ALLOWLIST;
}
