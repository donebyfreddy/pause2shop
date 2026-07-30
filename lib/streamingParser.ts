/**
 * Parser incremental del JSON de detección. El modelo genera
 * {"summary":"…","style_vibe":"…","items":[{…},{…},…]} token a token;
 * este parser extrae cada objeto de "items" EN CUANTO se cierra, sin esperar
 * al JSON completo — es lo que permite pintar detecciones progresivamente.
 *
 * Estrategia: escáner de caracteres con contexto de string/escape. El primer
 * `[` que aparece a profundidad 1 (dentro del objeto raíz) es el array de
 * items (es el único array top-level del esquema); cada `{…}` balanceado a
 * ese nivel es un item completo.
 */

export type ItemStreamParser = {
  /** Añade un chunk de texto; devuelve los items completos NUEVOS. */
  push(chunk: string): unknown[];
  /** Texto completo acumulado (para el parse final de summary/style_vibe). */
  fullText(): string;
};

export function createItemStreamParser(): ItemStreamParser {
  let buffer = "";
  let scanned = 0; // índice del último carácter procesado
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inItemsArray = false;
  let itemStart = -1; // índice de apertura del item en curso
  let done = false;

  function push(chunk: string): unknown[] {
    buffer += chunk;
    if (done) return [];
    const found: unknown[] = [];

    for (; scanned < buffer.length; scanned++) {
      const ch = buffer[scanned];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      switch (ch) {
        case '"':
          inString = true;
          break;
        case "{":
          depth++;
          if (inItemsArray && depth === 2 && itemStart === -1) {
            itemStart = scanned;
          }
          break;
        case "}":
          depth--;
          if (inItemsArray && depth === 1 && itemStart !== -1) {
            const raw = buffer.slice(itemStart, scanned + 1);
            itemStart = -1;
            try {
              found.push(JSON.parse(raw));
            } catch {
              // Item malformado: se ignora aquí; el parse final lo rescatará.
            }
          }
          break;
        case "[":
          if (!inItemsArray && depth === 1) {
            inItemsArray = true;
          } else {
            depth++;
          }
          break;
        case "]":
          if (inItemsArray && depth === 1) {
            inItemsArray = false;
            done = true; // el array de items se ha cerrado
          } else {
            depth--;
          }
          break;
        default:
          break;
      }
      if (done) break;
    }
    return found;
  }

  return { push, fullText: () => buffer };
}
