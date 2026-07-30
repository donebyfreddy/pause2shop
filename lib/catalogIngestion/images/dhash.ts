import sharp from "sharp";

/**
 * dHash 64-bit propio: se reduce la imagen a 9x8 en escala de grises y se
 * compara cada píxel con su vecino derecho → 64 bits. Es el mismo enfoque que
 * usa pause2shop/lib/video/frameDiff.ts; robusto ante reescalados y
 * recompresiones, que es exactamente lo que pasa con las imágenes de tienda.
 */

export async function dhash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

/** Distancia de Hamming entre dos dHash en hex (0–64). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
