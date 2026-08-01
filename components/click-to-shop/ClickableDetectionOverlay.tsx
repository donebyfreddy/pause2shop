"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { isValidBox, mapNormalizedBoxToRenderedVideo } from "@/lib/video/boxMapping";
import { presentationPriority } from "@/lib/priority";
import { itemKey } from "@/lib/utils";
import type { DetectedItem } from "@/lib/types";
import ProductConnectorLine from "./ProductConnectorLine";
import ProductHotspot from "./ProductHotspot";
import SelectedProductPopover from "./SelectedProductPopover";

type PositionedItem = {
  item: DetectedItem;
  rect: { x: number; y: number; width: number; height: number };
};

export default function ClickableDetectionOverlay({
  items,
  mediaAspect,
  selectedKey,
  onSelect,
}: {
  items: DetectedItem[];
  mediaAspect?: number | null;
  selectedKey?: string | null;
  onSelect: (item: DetectedItem) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [positioned, setPositioned] = useState<PositionedItem[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);

  const layout = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const width = node.clientWidth;
    const height = node.clientHeight;
    setContainerWidth(width);
    const aspect = mediaAspect && mediaAspect > 0 ? mediaAspect : 16 / 9;
    setPositioned(
      items
        .filter(
          (item) =>
            isValidBox(item.bounding_box) && presentationPriority(item) !== "low"
        )
        .map((item) => ({
          item,
          rect: mapNormalizedBoxToRenderedVideo(
            item.bounding_box!,
            aspect * 1000,
            1000,
            width,
            height,
            "contain"
          ),
        }))
    );
  }, [items, mediaAspect]);

  useEffect(() => {
    layout();
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(layout);
    observer.observe(node);
    return () => observer.disconnect();
  }, [layout]);

  const selected = positioned.find((entry) => itemKey(entry.item) === selectedKey);

  return (
    <div ref={ref} className="absolute inset-0 z-20" data-testid="clickable-detection-overlay">
      {positioned.map(({ item, rect }) => (
        <ProductHotspot
          key={itemKey(item)}
          item={item}
          selected={itemKey(item) === selectedKey}
          onSelect={() => onSelect(item)}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
      {selected ? (
        <>
          <ProductConnectorLine
            x={selected.rect.x + selected.rect.width}
            y={selected.rect.y + selected.rect.height / 2}
            width={Math.max(0, containerWidth - selected.rect.x - selected.rect.width)}
          />
          <SelectedProductPopover
            item={selected.item}
            style={
              {
                left: Math.min(
                  selected.rect.x + selected.rect.width + 10,
                  Math.max(8, containerWidth - 210)
                ),
                top: Math.max(8, selected.rect.y + selected.rect.height / 2 - 16),
              } as CSSProperties
            }
          />
        </>
      ) : null}
    </div>
  );
}
