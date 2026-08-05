import { NextRequest, NextResponse } from "next/server";
import {
  createAnalysisJob,
  getVideoAnalysisJobConfig,
  MAX_FRAMES_PER_BATCH,
  type CreateAnalysisJobInput,
} from "@/lib/analysis/jobs";
import { buildJobEngineDeps } from "@/lib/analysis/jobs/serverDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const deps = buildJobEngineDeps(req.nextUrl.origin);
  const jobs = await deps.store.listJobs(
    Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 100), 500)
  );
  return NextResponse.json({ ok: true, jobs, store: deps.store.kind });
}

/**
 * POST /api/analysis/jobs — crea un job de análisis asíncrono de vídeo.
 *
 * El vídeo NO viaja aquí: el cliente manda solo la metadata (duración, MIME,
 * tamaño) y después envía frames por lotes a /api/analysis/jobs/[id]/frames.
 * Devuelve el jobId y la config efectiva (fps, límites) para que el cliente
 * extraiga los frames con los mismos parámetros que espera el servidor.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: CreateAnalysisJobInput;
  try {
    body = (await req.json()) as CreateAnalysisJobInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const deps = buildJobEngineDeps(req.nextUrl.origin);
  const created = await createAnalysisJob(body, deps);
  if (!created.ok) {
    return NextResponse.json(
      { ok: false, error: created.error },
      { status: created.status }
    );
  }

  const config = getVideoAnalysisJobConfig();
  return NextResponse.json(
    {
      ok: true,
      jobId: created.job.id,
      job: created.job,
      reused: created.reused,
      staleJob: created.staleJob
        ? { id: created.staleJob.id, status: created.staleJob.status }
        : null,
      // Config efectiva para el extractor de frames del cliente.
      config: {
        detectionFps: config.detectionFps,
        maxVideoDurationSeconds: config.maxVideoDurationSeconds,
        maxFramesPerBatch: MAX_FRAMES_PER_BATCH,
        perceptualHashEnabled: config.perceptualHashEnabled,
        sceneDetectionEnabled: config.sceneDetectionEnabled,
      },
      store: deps.store.kind,
    },
    { status: created.reused ? 200 : 201 }
  );
}
