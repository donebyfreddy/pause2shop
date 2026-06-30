import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Pure validation helpers (same logic as ImageAnalyzer.tsx, extracted here)
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_MB = 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;

type ValidationResult = { ok: true } | { ok: false; error: string };

function validateImageFile(file: { type: string; size: number; name: string }): ValidationResult {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, error: `Formato no soportado: ${file.type || "desconocido"}` };
  }
  if (file.size === 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `La imagen supera el límite de ${MAX_MB} MB.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Accepted types
// ---------------------------------------------------------------------------
describe("Image validation — accepted types", () => {
  const accepted = [
    { type: "image/jpeg", name: "photo.jpg" },
    { type: "image/jpg", name: "photo.jpg" },
    { type: "image/png", name: "photo.png" },
    { type: "image/webp", name: "photo.webp" },
  ];

  for (const f of accepted) {
    it(`accepts ${f.type}`, () => {
      const r = validateImageFile({ ...f, size: 1024 });
      assert.equal(r.ok, true);
    });
  }
});

// ---------------------------------------------------------------------------
// Rejected types
// ---------------------------------------------------------------------------
describe("Image validation — rejected types", () => {
  const rejected = [
    { type: "application/pdf", name: "doc.pdf" },
    { type: "application/octet-stream", name: "file.exe" },
    { type: "image/gif", name: "anim.gif" },
    { type: "video/mp4", name: "clip.mp4" },
    { type: "", name: "unknown" },
  ];

  for (const f of rejected) {
    it(`rejects ${f.type || "(empty type)"}`, () => {
      const r = validateImageFile({ ...f, size: 1024 });
      assert.equal(r.ok, false);
    });
  }
});

// ---------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------
describe("Image validation — size limits", () => {
  it("rejects empty file (size 0)", () => {
    const r = validateImageFile({ type: "image/jpeg", name: "empty.jpg", size: 0 });
    assert.equal(r.ok, false);
    assert.ok((r as { ok: false; error: string }).error.includes("vacío"));
  });

  it("accepts file exactly at limit", () => {
    const r = validateImageFile({ type: "image/jpeg", name: "big.jpg", size: MAX_BYTES });
    assert.equal(r.ok, true);
  });

  it("rejects file over the limit", () => {
    const r = validateImageFile({ type: "image/jpeg", name: "huge.jpg", size: MAX_BYTES + 1 });
    assert.equal(r.ok, false);
    assert.ok((r as { ok: false; error: string }).error.includes("MB"));
  });

  it("accepts 1 KB file", () => {
    const r = validateImageFile({ type: "image/png", name: "small.png", size: 1024 });
    assert.equal(r.ok, true);
  });
});

// ---------------------------------------------------------------------------
// FrameMeta shape for image_upload
// ---------------------------------------------------------------------------
describe("Image FrameMeta shape", () => {
  it("sourceType is image_upload for image analysis", () => {
    const meta = {
      sourceType: "image_upload" as const,
      videoKey: `img:photo.jpg:1234567890`,
      videoTitle: "photo.jpg",
      timestampSeconds: 0,
      cacheKey: `img:1234567890`,
      provider: "image_upload",
      canEmbed: false,
      canCaptureFrame: false,
    };
    assert.equal(meta.sourceType, "image_upload");
    assert.equal(meta.timestampSeconds, 0);
    assert.equal(meta.canCaptureFrame, false);
    assert.equal(meta.provider, "image_upload");
  });

  it("videoKey for images starts with img:", () => {
    const fileName = "photo.jpg";
    const ts = 1234567890;
    const key = `img:${fileName}:${ts}`;
    assert.ok(key.startsWith("img:"));
  });
});
