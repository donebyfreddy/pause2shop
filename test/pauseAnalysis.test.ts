import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nearestAnalyzedFrame,
  pruneAnalyzedFrames,
  responseMatchesActiveSession,
  type AnalyzedVideoFrame,
} from "../lib/video/pauseAnalysis";
import type { DetectedItem } from "../lib/types";

const item = (name: string): DetectedItem => ({
  name,
  category: "clothing",
  description: name,
  search_query_es: name,
  alternative_queries: [],
  verified_provider_queries: [],
  confidence: 0.9,
  bounding_box: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
});

const frame = (mediaTime: number, name: string): AnalyzedVideoFrame => ({
  videoId: "video-1",
  frameId: `frame-${mediaTime}`,
  mediaTime,
  frameHash: `hash-${mediaTime}`,
  detections: [item(name)],
  tracks: [name],
  analyzedAt: mediaTime * 1000,
});

test("pausar en 00:05 elige el frame de 00:05 y no el anterior", () => {
  const nearest = nearestAnalyzedFrame(
    [frame(4, "frame anterior"), frame(5.04, "frame visible")],
    "video-1",
    5,
    250
  );
  assert.equal(nearest?.detections[0].name, "frame visible");
  assert.equal(nearest?.mediaTime, 5.04);
});

test("una respuesta de 00:04 nunca sustituye a la sesión activa de 00:05", () => {
  const active = { sessionId: "s5", frameId: "f5", mediaTime: 5 };
  assert.equal(
    responseMatchesActiveSession(
      { sessionId: "s4", frameId: "f4", mediaTime: 4 },
      active
    ),
    false
  );
  assert.equal(
    responseMatchesActiveSession(
      { sessionId: "s5", frameId: "f5", mediaTime: 5.04 },
      active
    ),
    true
  );
});

test("pausas consecutivas invalidan sessionId y frameId anteriores", () => {
  const first = { sessionId: "first", frameId: "frame-a", mediaTime: 5 };
  const second = { sessionId: "second", frameId: "frame-b", mediaTime: 7 };
  assert.equal(responseMatchesActiveSession(first, second), false);
  assert.equal(responseMatchesActiveSession(second, second), true);
});

test("la caché dura 120 s y deduplica el mismo frame", () => {
  const frames = pruneAnalyzedFrames(
    [frame(1, "viejo"), frame(130, "nuevo"), frame(130, "duplicado")],
    130,
    120
  );
  assert.equal(frames.length, 1);
  assert.equal(frames[0].detections[0].name, "duplicado");
});
