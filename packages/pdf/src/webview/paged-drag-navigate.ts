import {
  InteractionToken,
  type InteractionHandler,
  type PointerSample,
} from "@embedpdf/plugin-interaction/contract/host";
import type { PageRef } from "@embedpdf/engine";
import { SelectionToken } from "@embedpdf/plugin-selection/contract/host";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import { useEffect, useRef } from "react";
import { pagedDragPageDelta } from "../shared/paged-drag-navigate";
import type { ScrollDirection, ScrollMode } from "../shared/view-settings";

/**
 * Above Stage's pan handler (10) and below text selection (~60) and the
 * empty-space region tool (56), so a paged blank-area drag turns the page
 * instead of only panning inside it.
 */
const PAGED_DRAG_PRIORITY = 12;

export interface PagedDragNavigate {
  mode: ScrollMode;
  direction: ScrollDirection;
  step: (delta: 1 | -1) => void;
}

/**
 * The slice of EmbedPDF's selection capability `claimsTouch` may read.
 * Pure: no `ensureLoaded`. Unloaded geometry must not be treated as blank.
 */
export type PagedDragSelection = {
  isLoaded: (page: PageRef) => boolean;
  isOverText: (page: PageRef, point: { x: number; y: number }) => boolean;
};

export function pagedDragHandler(options: {
  isPaged: () => boolean;
  direction: () => ScrollDirection;
  step: (delta: 1 | -1) => void;
  selection: () => PagedDragSelection | null;
}): InteractionHandler {
  let start: { x: number; y: number } | undefined;
  const finish = (sample?: PointerSample): void => {
    if (!start) {
      return;
    }
    const end = sample?.viewport ?? start;
    const delta = pagedDragPageDelta(start, end, options.direction());
    start = undefined;
    if (delta !== 0) {
      options.step(delta);
    }
  };
  return {
    id: "lumia-paged-drag",
    priority: PAGED_DRAG_PRIORITY,
    enabledFor: (tool) => options.isPaged() && tool.enables.has("scroll"),
    /**
     * Second rung of StageSurface touch consent (`wouldClaimTouch`). Claim
     * only a loaded blank; never `!!sample.page`, and never set the read
     * tool's `touch` to `"draw"` (that would turn finger text drags into
     * selections). Off-page, missing selection, or geometry that is not
     * ready stay with native pan.
     */
    claimsTouch: (sample) => {
      if (!sample.page) {
        return false;
      }
      const selection = options.selection();
      if (!selection || !selection.isLoaded(sample.page.ref)) {
        return false;
      }
      return !selection.isOverText(sample.page.ref, sample.page.point);
    },
    onPointerDown: (sample) => {
      if (!sample.page) {
        return false;
      }
      // viewport = container CSS px, not page.point / PDF units.
      start = { x: sample.viewport.x, y: sample.viewport.y };
      return true;
    },
    onPointerUp: (sample) => finish(sample),
    onPointerCancel: () => {
      start = undefined;
    },
  };
}

/** Page-by-page blank-area drags turn the page; continuous mode is unchanged. */
export function usePagedDragNavigate(input: PagedDragNavigate): void {
  const interaction = useOptionalCapability(InteractionToken);
  const selection = useOptionalCapability(SelectionToken);
  const latest = useRef({ input, selection });
  latest.current = { input, selection };
  useEffect(() => {
    if (!interaction) {
      return;
    }
    return interaction.registerHandler(
      pagedDragHandler({
        isPaged: () => latest.current.input.mode === "paged",
        direction: () => latest.current.input.direction,
        step: (delta) => latest.current.input.step(delta),
        selection: () => latest.current.selection,
      }),
    );
  }, [interaction]);
}
