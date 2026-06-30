import { type NextRequest } from "next/server";
import { handleAnalyzeFrame } from "@/lib/server/analyzeFrameHandler";

/**
 * POST /api/vision/analyze-media
 *
 * Alias unificado de /api/vision/analyze-frame que acepta tanto frames de vídeo
 * como imágenes subidas o capturas de pantalla. El campo `sourceType` distingue
 * el origen: youtube | dailymotion | vimeo | direct_mp4 | hls | image_upload |
 * screen_capture | uploaded | external_url.
 *
 * Misma firma de request/response que analyze-frame.
 */
export const POST = (req: NextRequest) => handleAnalyzeFrame(req);
