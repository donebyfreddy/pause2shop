import type { Formats } from "next-intl";

/**
 * Formatos compartidos de fecha/número, resueltos con el locale activo.
 *
 * `usdCost` es para el seguimiento interno de coste (USD real, no un precio
 * al consumidor) — solo cambia el formato (símbolo, separadores), nunca la
 * cantidad subyacente.
 */

/**
 * Zona horaria por defecto de la aplicación.
 *
 * Sin esto, `next-intl` avisa por consola en cada formateo de fecha
 * (`ENVIRONMENT_FALLBACK`) y —lo importante— usa la zona del ENTORNO: la del
 * servidor al renderizar y la del navegador al hidratar. Cuando no coinciden,
 * el markup de una fecha difiere entre servidor y cliente. La auditoría
 * encontró ese aviso repetido en `/admin`, que es donde más fechas se pintan.
 *
 * `APP_TIME_ZONE` permite ajustarla por despliegue sin tocar código.
 */
export const TIME_ZONE = process.env.APP_TIME_ZONE || "Europe/Madrid";
export const FORMATS: Formats = {
  dateTime: {
    short: { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
    long: { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
    time: { hour: "2-digit", minute: "2-digit" },
  },
  number: {
    usdCost: { style: "currency", currency: "USD" },
    /** Precio al consumidor en euros. Lo usa el catálogo de la demo. */
    eurPrice: { style: "currency", currency: "EUR" },
    compact: { notation: "compact" },
    precise: { maximumFractionDigits: 2 },
  },
};
