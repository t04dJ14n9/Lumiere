import { SelectionToken } from "@embedpdf/plugin-selection/contract";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import React, { useCallback, useEffect, useRef } from "react";
import {
  createDeferredOpen,
  isOpenClick,
  type DeferredOpen,
  type ScreenPoint,
  type Timers,
} from "../shared/backlink-click";
import type { PdfBacklinkHit } from "../shared/pdf-backlink-index";
import type { SegmentRect } from "../shared/line-rects";
import { postToHost } from "./host";

export interface ResolvedOverlay {
  key: string;
  hit: PdfBacklinkHit;
  rects: SegmentRect[];
}

const BROWSER_TIMERS: Timers = {
  set: (run, delayMs) => window.setTimeout(run, delayMs),
  clear: (handle) => window.clearTimeout(handle as number),
};

/**
 * One note's highlighted lines. A click opens the note (see `isOpenClick`
 * for which clicks count). While the Annotate tool is active the lines are
 * `is-passive`, painted but letting every pointer event through to the
 * annotations under them.
 */
export function BacklinkOverlay({
  overlay,
  scale,
  isPassive,
}: {
  overlay: ResolvedOverlay;
  scale: number;
  isPassive: boolean;
}): React.JSX.Element {
  const clicks = useOverlayClicks(overlay.hit);
  return (
    <div
      className={
        isPassive ? "pdf-backlink-overlay is-passive" : "pdf-backlink-overlay"
      }
      title={overlay.hit.notePath}
      data-note-path={overlay.hit.notePath}
      data-note-uri={overlay.hit.noteUri}
      data-link-offset={overlay.hit.linkOffset}
      {...clicks}
    >
      {overlay.rects.map((rect, index) => (
        <div
          key={index}
          className="pdf-backlink-overlay-line"
          style={{
            left: rect.x * scale,
            top: rect.y * scale,
            width: rect.w * scale,
            height: rect.h * scale,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Open the note on a plain click only. The press also starts a selection (it
 * bubbles to the page), so a double-click or a drag along the line must
 * select, not navigate: a click that moved, followed a first one, or left a
 * selection is ignored, and the first click of what may become a double-click
 * opens after the double-click interval, unless a second press arrives.
 */
function useOverlayClicks(
  hit: PdfBacklinkHit,
): Pick<React.HTMLAttributes<HTMLDivElement>, "onPointerDown" | "onClick"> {
  const hasSelection = useHasTextSelection();
  const pressedAt = useRef<ScreenPoint | undefined>(undefined);
  const deferred = useRef<DeferredOpen | undefined>(undefined);
  deferred.current ??= createDeferredOpen(BROWSER_TIMERS);
  const pending = deferred.current;
  useEffect(() => () => pending.cancel(), [pending]);
  return {
    onPointerDown(event) {
      pending.cancel();
      pressedAt.current =
        event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
    },
    onClick(event) {
      const gesture = {
        pressedAt: pressedAt.current,
        clickedAt: { x: event.clientX, y: event.clientY },
        detail: event.detail,
        hasSelection: hasSelection(),
      };
      pressedAt.current = undefined;
      if (!isOpenClick(gesture)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pending.schedule(() => {
        // A selection made while waiting is the user's next gesture.
        if (!hasSelection()) {
          postToHost({
            type: "openBacklinkNote",
            noteUri: hit.noteUri,
            linkOffset: hit.linkOffset,
          });
        }
      });
    },
  };
}

/** Whether EmbedPDF holds a text selection now (read when asked). */
function useHasTextSelection(): () => boolean {
  const selection = useOptionalCapability(SelectionToken);
  return useCallback(() => selection?.hasSelection() ?? false, [selection]);
}
