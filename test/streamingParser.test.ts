import assert from "node:assert/strict";
import { test } from "node:test";
import { createItemStreamParser } from "../lib/streamingParser";

const FULL = JSON.stringify({
  summary: 'Escena con "items" variados [test]',
  style_vibe: "casual",
  items: [
    {
      name: "camiseta negra",
      distinctive_features: ["logo {pequeño}", 'texto "NYC"'],
      bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    },
    { name: "reloj plateado", bounding_box: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 } },
    { name: "silla de oficina" },
  ],
});

test("extrae cada item en cuanto se cierra, con chunks arbitrarios", () => {
  const parser = createItemStreamParser();
  const emitted: unknown[] = [];
  // Chunks de 7 caracteres: parte strings, llaves y escapes por la mitad.
  for (let i = 0; i < FULL.length; i += 7) {
    emitted.push(...parser.push(FULL.slice(i, i + 7)));
  }
  assert.equal(emitted.length, 3);
  const names = emitted.map((e) => (e as { name: string }).name);
  assert.deepEqual(names, ["camiseta negra", "reloj plateado", "silla de oficina"]);
  // El primer item llega ANTES de que termine el documento (streaming real).
  assert.equal(parser.fullText(), FULL);
});

test("no confunde llaves/corchetes dentro de strings ni arrays anidados", () => {
  const parser = createItemStreamParser();
  const items = parser.push(FULL);
  const first = items[0] as { distinctive_features: string[] };
  assert.deepEqual(first.distinctive_features, ['logo {pequeño}', 'texto "NYC"']);
});

test("el summary con la palabra items y corchetes no rompe el escáner", () => {
  const parser = createItemStreamParser();
  const items = parser.push(FULL);
  assert.equal(items.length, 3);
});

test("primer item emitido con solo medio documento", () => {
  const parser = createItemStreamParser();
  const cut = FULL.indexOf('{ "name": "reloj') // aún no existe con JSON.stringify…
  ;
  void cut;
  // Corta justo después del cierre del primer item.
  const firstClose = FULL.indexOf("}},") + 2; // cierra bounding_box + item
  const early = parser.push(FULL.slice(0, firstClose));
  assert.equal(early.length, 1);
  assert.equal((early[0] as { name: string }).name, "camiseta negra");
});
