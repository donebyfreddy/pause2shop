/**
 * Selección de proveedor de lectura.
 *
 * HuggingFace es la vía principal porque pagina; Kaggle es el fallback porque
 * obliga a descargar 570 MB. El importador habla solo con esta interfaz y no
 * sabe de dónde salen las filas, que es lo que permite probarlo con un lector
 * en memoria sin tocar la red.
 */
import {
  downloadImage,
  inspectDataset,
  streamRows,
} from "./huggingface";
import { inspectKaggle, kaggleCredentials, loadKaggleImage, streamKaggleRows } from "./kaggle";
import type {
  DatasetDescriptor,
  DatasetInfo,
  DatasetProviderId,
  FashionDatasetRow,
} from "./types";

export interface DatasetReader {
  readonly provider: DatasetProviderId;
  inspect(): Promise<DatasetInfo>;
  streamRows(options: {
    offset: number;
    limit: number;
    pageSize?: number;
  }): AsyncGenerator<FashionDatasetRow, void, undefined>;
  loadImage(row: FashionDatasetRow): Promise<{ buffer: Buffer; contentType: string } | null>;
}

function huggingfaceReader(descriptor: DatasetDescriptor): DatasetReader {
  return {
    provider: "huggingface",
    inspect: () => inspectDataset(descriptor),
    streamRows: (options) => streamRows(descriptor, options),
    loadImage: (row) => (row.imageUrl ? downloadImage(row.imageUrl) : Promise.resolve(null)),
  };
}

function kaggleReader(descriptor: DatasetDescriptor): DatasetReader {
  return {
    provider: "kaggle",
    inspect: () => inspectKaggle(descriptor),
    streamRows: (options) => streamKaggleRows(descriptor, options),
    loadImage: (row) => loadKaggleImage(row),
  };
}

export function getReader(
  descriptor: DatasetDescriptor,
  source: DatasetProviderId
): DatasetReader {
  if (source === "kaggle") {
    if (!kaggleCredentials()) {
      throw new Error(
        "source=kaggle requiere KAGGLE_USERNAME y KAGGLE_KEY, y que la cuenta " +
          "haya aceptado las condiciones del dataset en la web de Kaggle."
      );
    }
    return kaggleReader(descriptor);
  }
  return huggingfaceReader(descriptor);
}

/**
 * Lector con degradación automática: intenta HuggingFace y, si no responde,
 * pasa a Kaggle cuando hay credenciales. Si no las hay, se propaga el error de
 * HuggingFace, que es la causa real — anunciar "faltan credenciales de Kaggle"
 * cuando el problema es que HF está caído solo despista.
 */
export async function getReaderWithFallback(
  descriptor: DatasetDescriptor,
  preferred: DatasetProviderId
): Promise<{ reader: DatasetReader; info: DatasetInfo; fellBack: boolean }> {
  const primary = getReader(descriptor, preferred);
  const info = await primary.inspect();
  if (info.reachable) return { reader: primary, info, fellBack: false };

  const alternative: DatasetProviderId = preferred === "huggingface" ? "kaggle" : "huggingface";
  if (alternative === "kaggle" && !kaggleCredentials()) {
    throw new Error(
      `El dataset no es alcanzable vía ${preferred}: ${info.unreachableReason}. ` +
        "No hay fallback disponible (faltan KAGGLE_USERNAME y KAGGLE_KEY)."
    );
  }

  const secondary = getReader(descriptor, alternative);
  const secondaryInfo = await secondary.inspect();
  if (!secondaryInfo.reachable) {
    throw new Error(
      `El dataset no es alcanzable ni vía ${preferred} (${info.unreachableReason}) ` +
        `ni vía ${alternative} (${secondaryInfo.unreachableReason}).`
    );
  }
  return { reader: secondary, info: secondaryInfo, fellBack: true };
}
