import type { NextRequest } from "next/server";
import { handleAnalyzeFrame } from "@/lib/server/analyzeFrameHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ruta de compatibilidad. La canónica es POST /api/vision/analyze-frame.
 * Se mantiene para no romper clientes antiguos; delega en el mismo handler
 * (también persiste en el catálogo). La respuesta es un superconjunto de la
 * antigua { ok, analysis, mock }.
 */
export function POST(req: NextRequest) {
  return handleAnalyzeFrame(req);
}
