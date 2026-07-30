/**
 * Modo presentación: UI limpia para demos delante de stakeholders.
 * Oculta paneles técnicos (debug, costes crudos, warnings con detalle interno)
 * y usa estados amables. Se activa con NEXT_PUBLIC_PRESENTATION_MODE=true.
 */
export const IS_PRESENTATION =
  process.env.NEXT_PUBLIC_PRESENTATION_MODE === "true";
