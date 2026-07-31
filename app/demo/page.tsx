"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { PublicHeader } from "@/components/shell/PublicHeader";
import { PublicFooter } from "@/components/shell/PublicFooter";
import { useCallback, useEffect, useRef, useState } from "react";
import AnalysisConfigSelector from "@/components/AnalysisConfigSelector";
import VideoOverlay from "@/components/VideoOverlay";
import { captureFrameDataUrl } from "@/lib/frameCapture";
import { serializeConfig } from "@/lib/analysis/categories";
import { useAnalysisSettings } from "@/hooks/useAnalysisSettings";
import type {
  AnalysisJobStatusView,
  CropRequest,
  FrameBatchResult,
} from "@/lib/analysis/jobs/types";
import type { RawThumb } from "@/lib/analysis/jobs/perceptualHash";
import type { MatchingMode } from "@/lib/matching/types";
import type { BoundingBox, DetectedItem, VideoAnalysisConfig } from "@/lib/types";
import { formatTimestamp } from "@/lib/utils";

/**
 * DEMO de vídeo subido (≤ 2 min) con job de análisis asíncrono.
 *
 * El navegador decodifica el vídeo y extrae frames a los FPS que dicta el
 * servidor; el servidor mantiene el job (checkpoint reanudable, escenas,
 * tracking, dedup global) y hace matching UNA vez por producto único. Esta
 * página no toca app/page.tsx: es una superficie nueva.
 */

// Límite de duración en cliente (el servidor valida con su propio env).
const CLIENT_MAX_DURATION_S = Number(
  process.env.NEXT_PUBLIC_MAX_VIDEO_DURATION_SECONDS ?? "120"
);

const LABEL_STYLES: Record<string, string> = {
  CATALOG_MATCH: "border-success/50 bg-success/15 text-success",
  EXTERNAL_MATCH: "border-info/50 bg-info/15 text-info",
  SIMILAR: "border-warning/50 bg-warning/15 text-warning",
  NO_MATCH: "border-ink-subtle/40 bg-ink-subtle/10 text-ink-muted",
};

type Phase =
  | "idle"
  | "creating"
  | "scanning"
  | "matching"
  | "done"
  | "cancelled"
  | "error";

// ---------------------------------------------------------------------------
// Helpers de captura en cliente (frame + thumb RAW + crop)
// ---------------------------------------------------------------------------

const THUMB_W = 64;
const THUMB_H = 36;

/** Thumbnail RAW RGB del frame actual: el servidor hace hash/escenas con él. */
function captureThumb(video: HTMLVideoElement): RawThumb | null {
  if (!video.videoWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const { data } = ctx.getImageData(0, 0, THUMB_W, THUMB_H);
    const rgb = new Uint8Array(THUMB_W * THUMB_H * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    let bin = "";
    for (const b of rgb) bin += String.fromCharCode(b);
    return { width: THUMB_W, height: THUMB_H, rgbBase64: btoa(bin) };
  } catch {
    return null; // canvas tainted
  }
}

/** Seek con promesa (timeout defensivo por si `seeked` no dispara). */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05));
    setTimeout(done, 1500);
  });
}

/** Crop de un frame (data URL) según caja normalizada, con padding del 8%. */
async function cropFromFrame(
  frameDataUrl: string,
  box: BoundingBox
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const pad = 0.08;
      const x = Math.max(0, (box.x - pad * box.width) * img.width);
      const y = Math.max(0, (box.y - pad * box.height) * img.height);
      const w = Math.min(img.width - x, box.width * (1 + 2 * pad) * img.width);
      const h = Math.min(img.height - y, box.height * (1 + 2 * pad) * img.height);
      if (w < 8 || h < 8) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = frameDataUrl;
  });
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function DemoPage() {
  const t = useTranslations("demo");
  const format = useFormatter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cancelRef = useRef(false);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; type: string } | null>(null);
  const [duration, setDuration] = useState(0);
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Misma configuración compartida que el estudio (persistida en localStorage):
  // la fuente de coincidencias elegida aquí se conserva al volver a /studio.
  const { settings: analysisConfig, setSettings: setAnalysisConfig } =
    useAnalysisSettings();
  const [showBoxes, setShowBoxes] = useState(true);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0); // 0-1 del recorrido
  const [job, setJob] = useState<AnalysisJobStatusView | null>(null);
  const [liveItems, setLiveItems] = useState<Array<DetectedItem & { trackId: string }>>([]);

  const running = phase === "creating" || phase === "scanning" || phase === "matching";

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // Polling del estado del job mientras corre (progreso/contadores en vivo).
  useEffect(() => {
    if (!jobId || !running) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/analysis/jobs/${jobId}`);
        const body = await res.json();
        if (body.ok) setJob(body.job);
      } catch {
        // El polling nunca rompe el análisis.
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [jobId, running]);

  const handleFile = useCallback((file: File | null) => {
    setValidationError(null);
    setJob(null);
    setJobId(null);
    setPhase("idle");
    setError(null);
    setLiveItems([]);
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setValidationError(t("upload.notVideoError"));
      return;
    }
    setFileInfo({ name: file.name, size: file.size, type: file.type });
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, [t]);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    // La proporción se guarda en estado al cargar los metadatos: leer el ref
    // durante el render no es fiable (no provoca re-render al cambiar).
    setVideoAspect(
      video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : null
    );
    if (video.duration > CLIENT_MAX_DURATION_S) {
      setValidationError(
        t("upload.durationError", {
          seconds: Math.round(video.duration),
          maxSeconds: CLIENT_MAX_DURATION_S,
        })
      );
    }
  }, [t]);

  /** Sube a /crops los mejores encuadres pedidos por el servidor. */
  const fulfillCropRequests = useCallback(
    async (id: string, requests: CropRequest[], frameByTs: Map<number, string>) => {
      const crops: Array<{ trackId: string; timestampSeconds: number; dataUrl: string }> = [];
      for (const reqCrop of requests) {
        const frame = frameByTs.get(reqCrop.timestampSeconds);
        if (!frame) continue;
        const dataUrl = await cropFromFrame(frame, reqCrop.box);
        if (dataUrl) {
          crops.push({
            trackId: reqCrop.trackId,
            timestampSeconds: reqCrop.timestampSeconds,
            dataUrl,
          });
        }
      }
      if (!crops.length) return;
      await fetch(`/api/analysis/jobs/${id}/crops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crops }),
      }).catch(() => undefined);
    },
    []
  );

  const startAnalysis = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !fileInfo || validationError || !duration) return;
    cancelRef.current = false;
    setError(null);
    setJob(null);
    setLiveItems([]);
    setScanProgress(0);
    setPhase("creating");

    try {
      // 1) Crear el job (validación autoritativa en el servidor).
      const createRes = await fetch("/api/analysis/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: fileInfo.name,
          mimeType: fileInfo.type,
          sizeBytes: fileInfo.size,
          durationSeconds: duration,
          matchingMode: analysisConfig.matchingMode,
          analysisConfig: serializeConfig(analysisConfig),
        }),
      });
      const created = await createRes.json();
      if (!created.ok) throw new Error(created.error ?? t("errors.createJobFailed"));
      const id: string = created.jobId;
      const fps: number = created.config?.detectionFps ?? 5;
      const maxBatch: number = Math.min(created.config?.maxFramesPerBatch ?? 25, 8);
      setJobId(id);

      // 2) Recorrer el vídeo extrayendo frames a `fps` y enviarlos por lotes.
      setPhase("scanning");
      video.pause();
      const step = 1 / fps;
      let batch: Array<{ timestampSeconds: number; dataUrl: string; thumb: RawThumb | null }> = [];
      const frameByTs = new Map<number, string>();

      const flush = async () => {
        if (!batch.length) return;
        const payload = batch;
        batch = [];
        const res = await fetch(`/api/analysis/jobs/${id}/frames`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames: payload }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string } & FrameBatchResult;
        if (!body.ok) throw new Error(body.error ?? t("errors.frameBatchFailed"));
        // Overlay en vivo: detecciones del último frame analizado del lote.
        const lastAnalyzed = [...body.frames].reverse().find((f) => f.analyzed);
        if (lastAnalyzed) setLiveItems(lastAnalyzed.items);
        // Crops del mejor encuadre que pide el servidor.
        if (body.cropRequests?.length) {
          await fulfillCropRequests(id, body.cropRequests, frameByTs);
        }
        for (const f of payload) frameByTs.delete(f.timestampSeconds);
      };

      for (let t = 0; t < duration; t += step) {
        if (cancelRef.current) break;
        // Timestamps con precisión finita para que checkpoint/crops casen.
        const ts = Math.round(t * 1000) / 1000;
        await seekTo(video, ts);
        const dataUrl = captureFrameDataUrl(video);
        if (!dataUrl) continue;
        const thumb = captureThumb(video);
        batch.push({ timestampSeconds: ts, dataUrl, thumb });
        frameByTs.set(ts, dataUrl);
        setScanProgress(Math.min(1, t / duration));
        if (batch.length >= maxBatch) await flush();
      }
      await flush();
      setScanProgress(1);

      if (cancelRef.current) {
        await fetch(`/api/analysis/jobs/${id}/cancel`, { method: "POST" }).catch(() => undefined);
        setPhase("cancelled");
        return;
      }

      // 3) Finalizar: dedup global + matching por producto único.
      setPhase("matching");
      const finalRes = await fetch(`/api/analysis/jobs/${id}/finalize`, { method: "POST" });
      const finalBody = await finalRes.json();
      if (!finalBody.ok) throw new Error(finalBody.error ?? t("errors.finalizeFailed"));
      setJob(finalBody.job);
      setPhase(finalBody.job?.status === "cancelled" ? "cancelled" : "done");
      setLiveItems([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unknown"));
      setPhase("error");
    }
  }, [analysisConfig, duration, fileInfo, fulfillCropRequests, validationError, t]);

  const cancelAnalysis = useCallback(async () => {
    cancelRef.current = true;
    if (jobId) {
      await fetch(`/api/analysis/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => undefined);
    }
  }, [jobId]);

  const seekPlayer = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
    video.pause();
  }, []);


  const counters = job?.counters;
  const timings = job?.timings;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl text-ink sm:text-4xl">{t("page.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {t("page.description")}
          </p>
        </div>
        <Link
          href="/studio"
          className="text-xs font-medium text-ink-subtle transition-colors hover:text-brand-bright"
        >
          {t("page.goToStudio")}
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Columna izquierda: vídeo + configuración */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-line bg-white/[0.03] p-4">
            {/* h2, no h1: el h1 de la página es el título de la demo, arriba.
                Había dos h1 y eso rompe el esquema de encabezados para lectores
                de pantalla y para cualquier herramienta que derive el índice. */}
            <h2 className="text-base font-semibold text-ink">
              {t("upload.title", { seconds: CLIENT_MAX_DURATION_S })}
            </h2>
            <p className="mt-1 text-xs text-ink-subtle">{t("upload.description")}</p>
            <input
              type="file"
              accept="video/*"
              disabled={running}
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              className="mt-3 block w-full text-xs text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-bright hover:file:bg-brand/30"
            />
            {validationError && (
              <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {validationError}
              </p>
            )}
          </div>

          {videoUrl && (
            <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
              <video
                ref={videoRef}
                src={videoUrl}
                controls={!running}
                onLoadedMetadata={onLoadedMetadata}
                className="h-auto w-full"
                muted
                playsInline
              />
              {showBoxes && liveItems.length > 0 && (
                <VideoOverlay items={liveItems} videoAspect={videoAspect} />
              )}
              {running && (
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/10">
                  <div
                    className="h-full bg-brand transition-all"
                    style={{ width: `${Math.round(scanProgress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* La "Fuente de coincidencias" ya no se pinta aquí: vive dentro de
              AnalysisConfigSelector, el MISMO componente que usa el estudio. */}
          <AnalysisConfigSelector
            config={analysisConfig}
            onChange={setAnalysisConfig}
            locked={running}
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={startAnalysis}
              disabled={!videoUrl || Boolean(validationError) || running || !duration}
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? t("actions.analyzing") : t("actions.analyze")}
            </button>
            {running && (
              <button
                type="button"
                onClick={cancelAnalysis}
                className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger transition hover:bg-danger/20"
              >
                {t("actions.cancel")}
              </button>
            )}
            <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={showBoxes}
                onChange={(e) => setShowBoxes(e.target.checked)}
              />
              {t("actions.boundingBoxes")}
            </label>
          </div>

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
        </section>

        {/* Columna derecha: progreso del job */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">{t("job.title")}</h2>
              <StatusBadge phase={phase} jobStatus={job?.status} />
            </div>
            {jobId && (
              <p className="mt-1 truncate text-[10px] text-ink-faint">
                {t("job.idLabel", { jobId })}
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Stat label={t("job.stats.framesReceived")} value={counters?.framesReceived ?? 0} />
              <Stat label={t("job.stats.framesAnalyzed")} value={counters?.framesAnalyzed ?? 0} />
              <Stat label={t("job.stats.scenes")} value={counters?.scenes ?? 0} />
              <Stat label={t("job.stats.tracks")} value={counters?.tracks ?? 0} />
              <Stat label={t("job.stats.uniqueProducts")} value={counters?.uniqueProducts ?? 0} />
              <Stat label={t("job.stats.externalSearches")} value={counters?.externalSearchesUsed ?? 0} />
            </dl>
          </div>

          <div className="rounded-2xl border border-success/20 bg-success/[0.06] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-success">
              {t("savings.title")}
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Stat label={t("savings.framesDedup")} value={counters?.framesSkippedSimilar ?? 0} />
              <Stat label={t("savings.tracksMerged")} value={counters?.dedupMergedTracks ?? 0} />
              <Stat label={t("savings.cacheHits")} value={counters?.cacheHits ?? 0} />
              <Stat label={t("savings.catalogHits")} value={counters?.catalogHits ?? 0} />
            </dl>
          </div>

          {timings && (
            <div className="rounded-2xl border border-line bg-white/[0.03] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                {t("timings.title")}
              </h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <Stat label={t("timings.hashScenes")} value={`${timings.hashMs} ms`} />
                <Stat label={t("timings.detection")} value={`${timings.detectionMs} ms`} />
                <Stat label={t("timings.tracking")} value={`${timings.trackingMs} ms`} />
                <Stat label={t("timings.globalDedup")} value={`${timings.dedupMs} ms`} />
                <Stat label={t("timings.matching")} value={`${timings.matchingMs} ms`} />
                <Stat label={t("timings.total")} value={`${timings.totalMs} ms`} />
              </dl>
            </div>
          )}
        </aside>
      </div>

      {/* Productos únicos + timeline */}
      {job && job.products.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">
            {t("products.title", { count: job.products.length })}
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {job.products.map((p) => {
              const best = p.matching?.matches?.[0] ?? null;
              const label = p.matching?.matchLabel ?? "NO_MATCH";
              return (
                <article
                  key={p.productId}
                  className="rounded-2xl border border-line bg-white/[0.03] p-4"
                >
                  <div className="flex items-start gap-3">
                    {(p.bestCrop.cropDataUrl || best?.imageUrl) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.bestCrop.cropDataUrl ?? best?.imageUrl ?? ""}
                        alt={p.item.name}
                        className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{p.item.name}</p>
                      <p className="text-[11px] text-ink-subtle">
                        {p.item.category}
                        {p.trackIds.length > 1 && (
                          <span className="ml-1 text-success">
                            · {t("products.tracksMerged", { count: p.trackIds.length })}
                          </span>
                        )}
                      </p>
                      <span
                        className={
                          "mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold " +
                          (LABEL_STYLES[label] ?? LABEL_STYLES.NO_MATCH)
                        }
                      >
                        {label.replace("_", " ")}
                      </span>
                    </div>
                  </div>

                  {best && (
                    <div className="mt-2 text-xs text-ink-muted">
                      <p className="truncate">
                        <a
                          href={best.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-bright hover:underline"
                        >
                          {best.title}
                        </a>
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-subtle">
                        {t("products.scoreLine", {
                          score: (best.scores.finalScore * 100).toFixed(0),
                          source: best.source,
                          provider: best.provider,
                        })}
                        {best.price != null &&
                          ` · ${format.number(best.price, { style: "currency", currency: best.currency ?? "EUR" })}`}
                      </p>
                    </div>
                  )}
                  {p.matchingSkippedReason && (
                    <p className="mt-2 text-[11px] text-warning/80">
                      {t("products.matchingSkipped", { reason: p.matchingSkippedReason })}
                    </p>
                  )}

                  {/* Timeline de apariciones: clic → seek */}
                  <div className="mt-3">
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/5">
                      {duration > 0 &&
                        p.segments.map((s) => (
                          <button
                            key={`${p.productId}-${s.startSeconds}`}
                            type="button"
                            title={t("products.segmentTooltip", {
                              start: formatTimestamp(s.startSeconds),
                              end: formatTimestamp(s.endSeconds),
                            })}
                            onClick={() => seekPlayer(s.startSeconds)}
                            className="absolute top-0 h-full rounded-sm bg-brand-bright/80 transition hover:bg-brand-bright"
                            style={{
                              left: `${(s.startSeconds / duration) * 100}%`,
                              width: `${Math.max(1.2, ((s.endSeconds - s.startSeconds) / duration) * 100)}%`,
                            }}
                          />
                        ))}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.segments.map((s) => (
                        <button
                          key={`${p.productId}-chip-${s.startSeconds}`}
                          type="button"
                          onClick={() => seekPlayer(s.startSeconds)}
                          className="rounded border border-line bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:border-brand-bright/50 hover:text-brand-bright"
                        >
                          {formatTimestamp(s.startSeconds)}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {job && phase === "done" && job.products.length === 0 && (
        <p className="mt-8 rounded-lg border border-line bg-white/[0.03] px-4 py-3 text-sm text-ink-muted">
          {t("products.noProductsDetected")}
        </p>
      )}
      </main>
      <PublicFooter />
    </>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </>
  );
}

function StatusBadge({
  phase,
  jobStatus,
}: Readonly<{ phase: Phase; jobStatus?: string }>) {
  const t = useTranslations("demo.status");
  const text =
    phase === "idle"
      ? t("notStarted")
      : phase === "creating"
        ? t("creatingJob")
        : phase === "scanning"
          ? t("scanningFrames")
          : phase === "matching"
            ? t("matchingProducts")
            : (jobStatus ?? phase);
  const style =
    phase === "done"
      ? "border-success/50 bg-success/15 text-success"
      : phase === "error" || phase === "cancelled"
        ? "border-danger/40 bg-danger/10 text-danger"
        : phase === "idle"
          ? "border-line bg-white/5 text-ink-muted"
          : "border-brand-bright/50 bg-brand/15 text-brand-bright";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {text}
    </span>
  );
}
