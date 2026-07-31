"use client";

import DetectionOverlay from "@/components/DetectionOverlay";
import type { DetectedItem } from "@/lib/types";

/**
 * Canvas overlay sobre el reproductor: pinta bounding boxes de cada
 * DetectedItem. Delegado en DetectionOverlay (compartido con el modo imagen
 * del estudio) — mantiene esta API estrecha para no tocar los call sites
 * existentes (demo/page.tsx, VideoProviderAnalyzer).
 */

type Props = {
  items: DetectedItem[];
  onItemClick?: (item: DetectedItem) => void;
  /** Relación de aspecto real del vídeo (videoWidth/videoHeight); 16/9 si se desconoce. */
  videoAspect?: number | null;
  /** Pintar también objetos de prioridad baja (debug). */
  showLowPriority?: boolean;
  /** Item actualmente seleccionado (sincronizado con la card del panel). */
  selectedKey?: string | null;
};

export default function VideoOverlay({
  items,
  onItemClick,
  videoAspect,
  showLowPriority = false,
  selectedKey = null,
}: Props) {
  return (
    <DetectionOverlay
      items={items}
      onItemClick={onItemClick}
      mediaAspect={videoAspect}
      showLowPriority={showLowPriority}
      selectedKey={selectedKey}
    />
  );
}
