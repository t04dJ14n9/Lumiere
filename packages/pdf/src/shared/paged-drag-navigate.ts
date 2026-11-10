import type { ScrollDirection } from "./view-settings";

/**
 * How far a blank-page drag in page-by-page scrolling must travel, in view
 * pixels, before it turns the page. Same size as EmbedPDF's paged-wheel
 * push (`TURN_PUSH` in @embedpdf/plugin-stage).
 */
export const PAGED_DRAG_TURN_PX = 60;

/**
 * Which way a finished blank-page drag should turn in page-by-page
 * scrolling. Dragging up (or left, when reading horizontally) goes to the
 * next page, matching grab-to-pan toward later content. A shorter move is
 * a click and turns nothing.
 *
 * Stage's own turn stream only turns at an edge the gesture *began* at, so
 * a Fit Width page (taller than the viewer) can pan for the whole drag and
 * never call nextPage. This decision uses the drag's travel instead.
 */
export function pagedDragPageDelta(
  start: { x: number; y: number },
  end: { x: number; y: number },
  direction: ScrollDirection,
): 1 | -1 | 0 {
  const along = direction === "horizontal" ? start.x - end.x : start.y - end.y;
  if (along >= PAGED_DRAG_TURN_PX) {
    return 1;
  }
  if (along <= -PAGED_DRAG_TURN_PX) {
    return -1;
  }
  return 0;
}
