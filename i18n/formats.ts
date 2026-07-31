import type { Formats } from "next-intl";

/**
 * Formatos compartidos de fecha/número, resueltos con el locale activo.
 *
 * `usdCost` es para el seguimiento interno de coste (USD real, no un precio
 * al consumidor) — solo cambia el formato (símbolo, separadores), nunca la
 * cantidad subyacente.
 */
export const FORMATS: Formats = {
  dateTime: {
    short: { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
    long: { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
    time: { hour: "2-digit", minute: "2-digit" },
  },
  number: {
    usdCost: { style: "currency", currency: "USD" },
    compact: { notation: "compact" },
    precise: { maximumFractionDigits: 2 },
  },
};
