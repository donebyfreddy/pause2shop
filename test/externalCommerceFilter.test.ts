import assert from "node:assert/strict";
import { test } from "node:test";
import { isCommercialVisualCandidate } from "../lib/visualSearch/commercialFilter";
import type { VisualCandidate } from "../lib/visualSearch/types";

function candidate(over: Partial<VisualCandidate> = {}): VisualCandidate {
  return {
    source: "searchapi_google_lens",
    title: "Chaqueta técnica negra",
    link: "https://shop.example/products/jacket",
    store: "Shop Example",
    domain: "shop.example",
    imageUrl: "https://cdn.example/jacket.jpg",
    price: 129,
    currency: "EUR",
    brand: "Example",
    position: 1,
    exactImageMatch: false,
    queryUsed: null,
    ...over,
  };
}

test("acepta una ficha con merchant, precio y URL comercial", () => {
  assert.equal(isCommercialVisualCandidate(candidate()), true);
});

test("descarta noticias, personas y contenido editorial", () => {
  assert.equal(
    isCommercialVisualCandidate(
      candidate({
        title: "Celebrity interview: the jacket everyone talks about",
        link: "https://news.example/style/article",
        domain: "news.example",
        store: null,
        price: null,
      })
    ),
    false
  );
});

test("descarta redes y una imagen sin oferta comercial", () => {
  assert.equal(
    isCommercialVisualCandidate(
      candidate({
        link: "https://pinterest.com/pin/123",
        domain: "pinterest.com",
        store: null,
        price: null,
        brand: null,
      })
    ),
    false
  );
});
