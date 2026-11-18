import type { ScrollDirection } from "./view-settings";

/**
 * How far a blank-page drag in page-by-page scrolling must travel before it
 * turns the page, in CSS pixels of the Stage container — the same units as
 * `PointerSample.viewport` (`clientX - getBoundingClientRect().left` in
 * `@embedpdf/web` `createStageSurface`) and as EmbedPDF's paged-wheel push
 * (`TURN_PUSH`, documented "in screen px: about one wheel notch").
 *
 * These are not PDF page points and not `page.point`. PDF zoom
 * (`page.scale`, Fit Width 400%, Fit Page, Actual size) does not rescale
 * them: 50 CSS px is 50 CSS px at every zoom. They are also not multiplied
 * by `devicePixelRatio` (Stage reports DPR separately). A screenshot or
 * computer-use coordinate must be converted into this CSS space if the
 * capture is scaled relative to the display.
 */
const PAGED_DRAG_TURN_PX = 60;

/**
 * Which way a finished blank-page drag should turn in page-by-page
 * scrolling. `start` and `end` are Stage viewport CSS pixels (see
 * `PAGED_DRAG_TURN_PX`). Dragging up (or left, when reading horizontally)
 * goes to the next page, matching grab-to-pan toward later content. A
 * shorter move is a click and turns nothing.
 *
 * Stage's own turn stream only turns at an edge the gesture *began* at, so
 * a Fit Width page (taller than the viewer) can pan for the whole drag and
 * never call nextPage. This decision uses the drag's CSS travel instead.
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
