/**
 * Mensajes de error orientados al usuario final. El backend nunca debe
 * devolver JSON crudo de un proveedor externo (OpenAI, etc.) como mensaje
 * principal: aquí se separa el mensaje amigable (ES) del detalle técnico,
 * que la UI puede mostrar en un panel plegable "Detalles técnicos".
 */

export const FRIENDLY_ANALYSIS_ERROR =
  "No se pudo analizar el contenido. Revisa la configuración de la API de OpenAI o inténtalo de nuevo.";

export type AnalysisFailure = {
  /** Mensaje corto en español, seguro para mostrar como mensaje principal. */
  message: string;
  /** Detalle técnico crudo (stack, cuerpo de error del proveedor…), opcional. */
  detail?: string;
};

/** Convierte cualquier error de la llamada de visión en un fallo amigable + detalle técnico. */
export function toAnalysisFailure(err: unknown): AnalysisFailure {
  const detail = err instanceof Error ? err.message : String(err);
  return { message: FRIENDLY_ANALYSIS_ERROR, detail };
}
