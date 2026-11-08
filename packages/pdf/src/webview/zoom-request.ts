import type { ZoomLevel } from "@embedpdf/plugin-zoom/react";
import { flushSync } from "react-dom";

/** The part of EmbedPDF's document zoom this needs. */
interface RequestsZoom {
  requestZoom(level: ZoomLevel, center?: { vx: number; vy: number }): void;
}

/**
 * Ask EmbedPDF for a zoom and have React lay the pages out at the new scale
 * before returning.
 *
 * EmbedPDF's zoom plugin scrolls to the anchor of the step (the point under
 * the pointer, the viewer's centre) from a requestAnimationFrame, while React
 * commits the new layout in a task of its own. When a frame is painted between
 * the two (a busy main thread: dark pages, a large display, a slow machine)
 * it shows the old pages at the new scroll offset: another page, or a blank
 * viewport in a long document, and over a pinch's preview. Committing in the
 * same task as the request puts the new layout in the frame that scrolls.
 */
export function requestZoomWithLayout(
  zoom: RequestsZoom,
  level: ZoomLevel,
  center?: { vx: number; vy: number },
): void {
  flushSync(() => zoom.requestZoom(level, center));
}
