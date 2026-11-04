/**
 * LEGACY / UNHOOKED — Unhooked: SidecarHighlightLayer removed from page.tsx. Passage marks are backlink-layer.tsx overlays.
 * See packages/pdf/docs/sidecar-highlights.md.
 */
import React, { useSyncExternalStore } from "react";
import { displayHighlightAppearance } from "../shared/highlight-style";
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
  // Re-render when paper flips so legacy 0.45 / EmbedPDF stock paint updates.
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
          style={paintVars(highlight, paper)}
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

function paintVars(
  highlight: { color: string; opacity: number },
  paper: ReturnType<typeof currentPageColors>,
): React.CSSProperties {
  const painted = displayHighlightAppearance(highlight, paper);
  return {
    "--highlight-color": painted.color,
    "--highlight-opacity": painted.opacity,
  } as React.CSSProperties;
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
