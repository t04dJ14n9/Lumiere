/**
 * How much one wheel event zooms the diagram inspector: in proportion to how
 * far it scrolls, as browsers and image viewers zoom a pinch.
 *
 * A trackpad pinch arrives as many wheel events with `ctrlKey` and small
 * deltas (a few pixels each); a mouse wheel notch as one event of about 100
 * pixels, or a few lines. A fixed step per event made a pinch zoom by 15 %
 * for every tiny movement of the fingers. Each event's delta is capped, so a
 * notch keeps the 15 % step it had.
 */

/** Zoom per pixel of wheel delta: ln(scale) changes by this much. */
export const ZOOM_PER_PIXEL = 0.01;

/** The most one event counts for: a mouse wheel notch, about 15 %. */
export const MAX_EVENT_PIXELS = 15;

/** Pixels per line and per page, for wheel events measured in those. */
const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;

export function wheelZoomFactor(event: {
  deltaY: number;
  deltaMode: number;
}): number {
  const pixels = event.deltaY * pixelsPerUnit(event.deltaMode);
  const counted = Math.max(
    -MAX_EVENT_PIXELS,
    Math.min(MAX_EVENT_PIXELS, pixels),
  );
  return Math.exp(-counted * ZOOM_PER_PIXEL);
}

/** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
function pixelsPerUnit(deltaMode: number): number {
  if (deltaMode === 1) {
    return LINE_PIXELS;
  }
  if (deltaMode === 2) {
    return PAGE_PIXELS;
  }
  return 1;
}
