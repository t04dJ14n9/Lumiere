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
 * empty-space region tool (56), so a paged mouse/pen blank-area drag turns
 * the page instead of only panning inside it. Touch contacts stay with
 * Stage's native navigation: `claimsTouch` would claim a whole contact from
 * its first pixel and suppress pan, fling, double-tap and pinch arbitration.
 */
const PAGED_DRAG_PRIORITY = 12;

export interface PagedDragNavigate {
  mode: ScrollMode;
  direction: ScrollDirection;
  step: (delta: 1 | -1) => void;
}

/**
 * The slice of EmbedPDF's selection capability the handler may read.
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
  /**
   * A press on text with cold geometry looks blank to text selection, but
   * must not turn a page before geometry has loaded. Touch is not claimed
   * here; Stage's native pan and pinch own those contacts.
   */
  const isLoadedBlank = (sample: PointerSample): boolean => {
    const page = sample.page;
    if (!page) {
      return false;
    }
    const selection = options.selection();
    return Boolean(
      selection &&
      selection.isLoaded(page.ref) &&
      !selection.isOverText(page.ref, page.point),
    );
  };
  const finish = (sample?: PointerSample): void => {
    if (!start) {
      return;
    }
    const end = sample?.viewport ?? start;
    // A view-mode change mid-drag must not turn a page that is now continuous.
    const delta = options.isPaged()
      ? pagedDragPageDelta(start, end, options.direction())
      : 0;
    start = undefined;
    if (delta !== 0) {
      options.step(delta);
    }
  };
  return {
    id: "lumiere-paged-drag",
    priority: PAGED_DRAG_PRIORITY,
    enabledFor: (tool) => options.isPaged() && tool.enables.has("scroll"),
    onPointerDown: (sample) => {
      if (!isLoadedBlank(sample)) {
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

/**
 * Page-by-page mouse/pen blank-area drags turn the page; continuous and
 * touch stay with Stage.
 */
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
