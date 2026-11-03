import React, { useSyncExternalStore } from "react";
import { displayHighlightOpacity } from "../shared/highlight-style";
import { currentPageColors, onPageColorsChange } from "./page-colors";
import { onSidecarChange, sidecarState } from "./sidecar-store";

/**
 * The sidecar highlights on one page, drawn over its picture like a
 * highlighter (multiplied, so the text shows through). They take no pointer
 * events: Annotate mode finds the mark under a click itself
 * (sidecar-selection.ts), and the page's text stays selectable through them.
 */
export function SidecarHighlightLayer({
  pageIndex,
  scale,
}: {
  pageIndex: number;
  scale: number;
}): React.JSX.Element | null {
  const { highlights, selectedId, staleIds } = useSyncExternalStore(
    onSidecarChange,
    sidecarState,
  );
  // Re-render when paper flips so legacy 0.45 → dark display opacity updates.
  useSyncExternalStore(onPageColorsChange, currentPageColors);
  const paper = currentPageColors();
  const marks = highlights?.filter(({ page }) => page === pageIndex + 1);
  if (!marks?.length) {
    return null;
  }
  return (
    <>
      {marks.map((highlight) => (
        <div
          key={highlight.id}
          className={classNames(highlight.id, selectedId, staleIds)}
          data-highlight-id={highlight.id}
          style={
            {
              "--highlight-color": highlight.color,
              "--highlight-opacity": displayHighlightOpacity(
                highlight.opacity,
                paper,
              ),
            } as React.CSSProperties
          }
        >
          {highlight.segmentRects.map((rect, index) => (
            <div
              key={index}
              className="sidecar-highlight-line"
              style={{
                left: rect.x * scale,
                top: rect.y * scale,
                width: rect.w * scale,
                height: rect.h * scale,
              }}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function classNames(
  id: string,
  selectedId: string | undefined,
  staleIds: readonly string[],
): string {
  return [
    "sidecar-highlight",
    ...(id === selectedId ? ["is-selected"] : []),
    ...(staleIds.includes(id) ? ["is-stale"] : []),
  ].join(" ");
}
