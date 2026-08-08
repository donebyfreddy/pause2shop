import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryExternalCandidateStore, externalCandidateKey } from "../lib/videoProcessing/candidateStore";
import { sha256File } from "../lib/videoProcessing/hash";
import { mergeProgressiveDetection } from "../hooks/useObjectMatching";
import type { DetectionMatchResult } from "../lib/matching/types";

const baseCandidate = {
  id: "source-1",
  title: "Polo oscuro",
  imageUrl: "https://merchant.example/polo.jpg",
  merchant: "Merchant",
  price: 59,
  currency: "EUR",
  productUrl: "https://merchant.example/polo",
  category: "clothing",
  visualScore: 0.84,
  commercialScore: 1,
  finalScore: 0.82,
  provider: "searchapi_google_lens",
  evidence: ["Imagen y oferta comercial"],
  attributes: { color: "negro" },
};

test("SHA-256 identifica el contenido y no el nombre del vídeo", async () => {
  const a = await sha256File(new Blob(["mismo contenido"]));
  const b = await sha256File(new Blob(["mismo contenido"]));
  const c = await sha256File(new Blob(["otro contenido"]));
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("el mismo candidato externo se guarda una vez y nunca se publica solo", async () => {
  const store = new InMemoryExternalCandidateStore();
  const first = await store.save(baseCandidate);
  const second = await store.save(baseCandidate);
  assert.equal(first.id, second.id);
  assert.equal(first.status, "review_required");
  assert.equal(first.catalogProductId, undefined);
  assert.equal(externalCandidateKey(baseCandidate), first.candidateKey);
  assert.equal((await store.list()).length, 1);
});

test("aprobar y publicar son estados separados y rechazo no crea producto", async () => {
  const store = new InMemoryExternalCandidateStore();
  const candidate = await store.save(baseCandidate);
  const approved = await store.updateStatus(candidate.id, "approved", { reviewedBy: "qa" });
  assert.equal(approved?.status, "approved");
  assert.equal(approved?.catalogProductId, undefined);
  const published = await store.updateStatus(candidate.id, "published", {
    reviewedBy: "qa",
    catalogProductId: "catalog-product-1",
  });
  assert.equal(published?.status, "published");
  assert.equal(published?.catalogProductId, "catalog-product-1");

  const rejectedCandidate = await store.save({ ...baseCandidate, productUrl: "https://merchant.example/otro" });
  const rejected = await store.updateStatus(rejectedCandidate.id, "rejected");
  assert.equal(rejected?.status, "rejected");
  assert.equal(rejected?.catalogProductId, undefined);
});

function detection(source: "catalog" | "external"): DetectionMatchResult {
  return {
    detectionId: "polo",
    label: "Polo oscuro",
    confidence: 0.88,
    boundingBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 },
    timestampSeconds: 5,
    matchingMode: source === "catalog" ? "catalog_only" : "external_only",
    catalog: source === "catalog"
      ? { status: "unresolved", candidates: [], threshold: 0.8 }
      : { status: "not_requested", candidates: [], threshold: 0.8 },
    external: source === "external"
      ? { status: "matched", candidates: [], threshold: 0.72 }
      : { status: "not_requested", candidates: [], threshold: 0.72 },
  };
}

test("la actualización externa conserva el bloque de catálogo ya visible", () => {
  const merged = mergeProgressiveDetection(detection("catalog"), detection("external"));
  assert.equal(merged?.catalog.status, "unresolved");
  assert.equal(merged?.external.status, "matched");
  assert.equal(merged?.matchingMode, "catalog_first");
});

test("la comparación paralela conserva ambos bloques y su modo", () => {
  const merged = mergeProgressiveDetection(
    detection("catalog"),
    detection("external"),
    "catalog_and_external"
  );
  assert.equal(merged?.catalog.status, "unresolved");
  assert.equal(merged?.external.status, "matched");
  assert.equal(merged?.matchingMode, "catalog_and_external");
});
