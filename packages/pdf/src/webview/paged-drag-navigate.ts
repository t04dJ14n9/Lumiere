import {
  InteractionToken,
  type InteractionHandler,
  type PointerSample,
} from "@embedpdf/plugin-interaction/contract/host";
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

export function pagedDragHandler(options: {
  isPaged: () => boolean;
  direction: () => ScrollDirection;
  step: (delta: 1 | -1) => void;
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
    onPointerDown: (sample) => {
      if (!sample.page) {
        return false;
      }
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
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (!interaction) {
      return;
    }
    return interaction.registerHandler(
      pagedDragHandler({
        isPaged: () => latest.current.mode === "paged",
        direction: () => latest.current.direction,
        step: (delta) => latest.current.step(delta),
      }),
    );
  }, [interaction]);
}
