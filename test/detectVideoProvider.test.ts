import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectVideoProvider } from "../lib/video/detectVideoProvider";

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------
describe("YouTube detection", () => {
  const cases = [
    "https://www.youtube.com/watch?v=abc123",
    "https://youtu.be/abc123",
    "https://www.youtube.com/embed/abc123",
    "https://youtube.com/watch?v=abc123",
    "https://m.youtube.com/watch?v=abc123",
    "https://www.youtube.com/shorts/abc123",
  ];

  for (const url of cases) {
    it(`detects YouTube: ${url}`, () => {
      const r = detectVideoProvider(url);
      assert.equal(r.provider, "youtube");
      assert.equal(r.canEmbed, true);
      assert.equal(r.canCaptureFrame, false);
      assert.ok(r.videoId, "should extract videoId");
      assert.ok(r.embedUrl?.includes("youtube.com/embed/"), "should build embed URL");
    });
  }
});

// ---------------------------------------------------------------------------
// Dailymotion
// ---------------------------------------------------------------------------
describe("Dailymotion detection", () => {
  const cases = [
    { url: "https://www.dailymotion.com/video/x8abcde", expectedId: "x8abcde" },
    { url: "https://dai.ly/x8abcde", expectedId: "x8abcde" },
    { url: "https://www.dailymotion.com/embed/video/x8abcde", expectedId: "x8abcde" },
    { url: "https://dailymotion.com/video/x8abcde", expectedId: "x8abcde" },
  ];

  for (const { url, expectedId } of cases) {
    it(`detects Dailymotion: ${url}`, () => {
      const r = detectVideoProvider(url);
      assert.equal(r.provider, "dailymotion");
      assert.equal(r.canEmbed, true);
      assert.equal(r.canCaptureFrame, false);
      assert.equal(r.videoId, expectedId);
      assert.equal(r.embedUrl, `https://www.dailymotion.com/embed/video/${expectedId}`);
      assert.equal(r.normalizedUrl, `https://www.dailymotion.com/video/${expectedId}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Vimeo
// ---------------------------------------------------------------------------
describe("Vimeo detection", () => {
  const cases = [
    { url: "https://vimeo.com/123456789", expectedId: "123456789" },
    { url: "https://www.vimeo.com/123456789", expectedId: "123456789" },
    { url: "https://player.vimeo.com/video/123456789", expectedId: "123456789" },
  ];

  for (const { url, expectedId } of cases) {
    it(`detects Vimeo: ${url}`, () => {
      const r = detectVideoProvider(url);
      assert.equal(r.provider, "vimeo");
      assert.equal(r.canEmbed, true);
      assert.equal(r.canCaptureFrame, false);
      assert.equal(r.videoId, expectedId);
      assert.equal(r.embedUrl, `https://player.vimeo.com/video/${expectedId}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Direct MP4
// ---------------------------------------------------------------------------
describe("Direct MP4 detection", () => {
  const cases = [
    "https://cdn.example.com/video.mp4",
    "https://cdn.example.com/video.mp4?token=123",
    "https://cdn.example.com/path/to/video.MP4",
  ];

  for (const url of cases) {
    it(`detects direct MP4: ${url}`, () => {
      const r = detectVideoProvider(url);
      assert.equal(r.provider, "direct_mp4");
      assert.equal(r.canEmbed, true);
      assert.equal(r.canCaptureFrame, true);
    });
  }
});

// ---------------------------------------------------------------------------
// HLS
// ---------------------------------------------------------------------------
describe("HLS detection", () => {
  const cases = [
    "https://cdn.example.com/stream.m3u8",
    "https://cdn.example.com/stream.m3u8?token=123",
  ];

  for (const url of cases) {
    it(`detects HLS: ${url}`, () => {
      const r = detectVideoProvider(url);
      assert.equal(r.provider, "hls");
      assert.equal(r.canEmbed, true);
      assert.equal(r.canCaptureFrame, true);
    });
  }
});

// ---------------------------------------------------------------------------
// Unknown
// ---------------------------------------------------------------------------
describe("Unknown provider detection", () => {
  const cases = [
    "https://example.com/post/123",
    "https://example.com/some-page",
    "https://twitch.tv/channel",
  ];

  for (const url of cases) {
    it(`returns unknown for: ${url}`, () => {
      const r = detectVideoProvider(url);
      assert.equal(r.provider, "unknown");
      assert.equal(r.canEmbed, false);
      assert.equal(r.canCaptureFrame, false);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("Edge cases", () => {
  it("handles empty string gracefully", () => {
    const r = detectVideoProvider("");
    assert.equal(r.provider, "unknown");
  });

  it("preserves originalUrl", () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    const r = detectVideoProvider(url);
    assert.equal(r.originalUrl, url);
  });

  it("normalizes YouTube youtu.be to full watch URL", () => {
    const r = detectVideoProvider("https://youtu.be/abc123");
    assert.equal(r.normalizedUrl, "https://www.youtube.com/watch?v=abc123");
  });

  it("normalizes Dailymotion dai.ly to full video URL", () => {
    const r = detectVideoProvider("https://dai.ly/x8abcde");
    assert.equal(r.normalizedUrl, "https://www.dailymotion.com/video/x8abcde");
  });
});
