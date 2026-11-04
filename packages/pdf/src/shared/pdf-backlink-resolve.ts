/**
 * Resolve a Chrome Text Fragment `textStart` to glyph line rects on a page.
 * Soft-fails (undefined) when the text is missing or has no drawable glyphs.
 */
import type { SegmentRect } from "./sidecar-format";
import { lineRects, type GlyphBox } from "./sidecar-reattach";

/**
 * First exact `indexOf(textStart)` on `pageText`; glyph boxes are parallel to
 * characters (`undefined` for spaces / empty glyphs). Missing text or empty
 * drawable boxes → undefined (skip overlay paint).
 */
export function resolveTextToLineRects(
  pageText: string,
  glyphBoxes: readonly (GlyphBox | undefined)[],
  textStart: string,
): SegmentRect[] | undefined {
  if (!textStart) {
    return undefined;
  }
  const start = pageText.indexOf(textStart);
  if (start < 0) {
    return undefined;
  }
  const end = start + textStart.length;
  const boxes = glyphBoxes
    .slice(start, end)
    .filter((box): box is GlyphBox => box !== undefined);
  if (boxes.length === 0) {
    return undefined;
  }
  const rects = lineRects(boxes);
  return rects.length > 0 ? rects : undefined;
}
