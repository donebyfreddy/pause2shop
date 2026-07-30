import type { BoundingBox } from "@/lib/types";

/**
 * Hash perceptual y métricas de frame EN SERVIDOR, sin dependencias nativas.
 *
 * El servidor Node no puede decodificar JPEG sin añadir sharp/canvas, así que
 * el CLIENTE (que ya decodifica el vídeo) manda junto a cada frame un
 * thumbnail RAW diminuto (RGB, ~64×36) — es el mismo truco que
 * lib/video/frameDiff.ts usa en el navegador, portado aquí como matemática
 * pura: diff medio (escenas / casi-duplicados), aHash 8×8 (firma perceptual
 * de frame o de una región = crop) y nitidez por gradiente (mejor crop).
 * Todo puro ⇒ testeable sin red ni DOM.
 */

export type RawThumb = {
  width: number;
  height: number;
  /** Píxeles RGB (3 bytes/px) en base64. */
  rgbBase64: string;
};

export type DecodedThumb = {
  width: number;
  height: number;
  rgb: Uint8Array;
};

export function decodeThumb(thumb: RawThumb): DecodedThumb | null {
  if (!thumb || thumb.width <= 0 || thumb.height <= 0 || !thumb.rgbBase64) {
    return null;
  }
  const rgb = Uint8Array.from(Buffer.from(thumb.rgbBase64, "base64"));
  if (rgb.length !== thumb.width * thumb.height * 3) return null;
  return { width: thumb.width, height: thumb.height, rgb };
}

/** Codifica píxeles RGB como RawThumb (útil en tests y fixtures). */
export function encodeThumb(
  width: number,
  height: number,
  rgb: Uint8Array | number[]
): RawThumb {
  return {
    width,
    height,
    rgbBase64: Buffer.from(Uint8Array.from(rgb)).toString("base64"),
  };
}

/**
 * Diferencia perceptual media entre dos thumbs (0 = idénticos, 1 = opuestos).
 * Mismo cálculo que computeFrameDiffFromVideo pero puro. Dimensiones
 * distintas ⇒ 1 (frame de otra fuente: trátalo como cambio total).
 */
export function thumbDiff(a: DecodedThumb, b: DecodedThumb): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const len = a.rgb.length;
  let total = 0;
  for (let i = 0; i < len; i += 3) {
    total +=
      (Math.abs(a.rgb[i] - b.rgb[i]) +
        Math.abs(a.rgb[i + 1] - b.rgb[i + 1]) +
        Math.abs(a.rgb[i + 2] - b.rgb[i + 2])) /
      (3 * 255);
  }
  return total / (a.width * a.height);
}

/** Región del thumb en píxeles a partir de una caja normalizada 0-1. */
function regionOf(
  thumb: DecodedThumb,
  box?: BoundingBox | null
): { x0: number; y0: number; x1: number; y1: number } {
  if (!box) return { x0: 0, y0: 0, x1: thumb.width, y1: thumb.height };
  const x0 = Math.max(0, Math.floor(box.x * thumb.width));
  const y0 = Math.max(0, Math.floor(box.y * thumb.height));
  const x1 = Math.min(thumb.width, Math.ceil((box.x + box.width) * thumb.width));
  const y1 = Math.min(
    thumb.height,
    Math.ceil((box.y + box.height) * thumb.height)
  );
  // Región degenerada (caja diminuta en un thumb pequeño): al menos 1×1.
  return {
    x0,
    y0,
    x1: Math.max(x1, x0 + 1),
    y1: Math.max(y1, y0 + 1),
  };
}

function grayAt(thumb: DecodedThumb, x: number, y: number): number {
  const i = (y * thumb.width + x) * 3;
  // Luma aproximada (Rec. 601).
  return 0.299 * thumb.rgb[i] + 0.587 * thumb.rgb[i + 1] + 0.114 * thumb.rgb[i + 2];
}

/**
 * aHash 8×8 de un thumb (o de una región = firma del crop): remuestrea la
 * región a 8×8 en gris, y cada bit = píxel por encima de la media. Devuelve
 * 16 caracteres hex. Robusto a re-encodings y pequeños desplazamientos.
 */
export function averageHash(
  thumb: DecodedThumb,
  box?: BoundingBox | null
): string {
  const { x0, y0, x1, y1 } = regionOf(thumb, box);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const cells = new Array<number>(64).fill(0);

  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      // Media de la celda (box filter sobre la región mapeada).
      const sx0 = x0 + Math.floor((gx * rw) / 8);
      const sx1 = Math.max(sx0 + 1, x0 + Math.ceil(((gx + 1) * rw) / 8));
      const sy0 = y0 + Math.floor((gy * rh) / 8);
      const sy1 = Math.max(sy0 + 1, y0 + Math.ceil(((gy + 1) * rh) / 8));
      let sum = 0;
      let n = 0;
      for (let y = sy0; y < sy1 && y < thumb.height; y++) {
        for (let x = sx0; x < sx1 && x < thumb.width; x++) {
          sum += grayAt(thumb, x, y);
          n++;
        }
      }
      cells[gy * 8 + gx] = n ? sum / n : 0;
    }
  }

  const mean = cells.reduce((a, b) => a + b, 0) / 64;
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) {
      nibble = (nibble << 1) | (cells[i + b] > mean ? 1 : 0);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

const POPCOUNT = new Array<number>(16)
  .fill(0)
  .map((_, n) => ((n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1)));

/** Distancia de Hamming entre dos hashes hex (0-64 para aHash 8×8). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    dist += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return dist;
}

/**
 * Nitidez aproximada 0-1 de una región: energía media del gradiente en gris.
 * Un crop borroso (motion blur, desenfoque) puntúa bajo; sirve como tercer
 * criterio (junto a área y confianza) para elegir el mejor crop de un track.
 */
export function sharpnessScore(
  thumb: DecodedThumb,
  box?: BoundingBox | null
): number {
  const { x0, y0, x1, y1 } = regionOf(thumb, box);
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1 - 1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const g = grayAt(thumb, x, y);
      sum += Math.abs(g - grayAt(thumb, x + 1, y)) + Math.abs(g - grayAt(thumb, x, y + 1));
      n += 2;
    }
  }
  if (!n) return 0;
  // Normalización empírica: un gradiente medio de ~32 niveles ya es "nítido".
  return Math.min(1, sum / n / 32);
}
