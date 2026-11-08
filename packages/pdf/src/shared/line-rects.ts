/**
 * Boxes over the glyphs of a passage: one rectangle per line, which is what a
 * backlink overlay paints. Pure; the viewer reads the glyphs.
 */

/** Left, top, right, bottom in points, as glyph boxes come. */
export type GlyphBox = [number, number, number, number];

/** One line's box of a passage, in points from the page's top-left. */
export interface SegmentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One box per line of the given glyph boxes (glyphs that overlap
 * vertically by half a line are on one line), in reading order.
 */
export function lineRects(boxes: readonly GlyphBox[]): SegmentRect[] {
  const lines: GlyphBox[] = [];
  for (const box of boxes) {
    const line = lines.at(-1);
    if (line && overlapsVertically(line, box)) {
      lines[lines.length - 1] = [
        Math.min(line[0], box[0]),
        Math.min(line[1], box[1]),
        Math.max(line[2], box[2]),
        Math.max(line[3], box[3]),
      ];
    } else {
      lines.push([...box]);
    }
  }
  return lines.map(([left, top, right, bottom]) => ({
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  }));
}

function overlapsVertically(a: GlyphBox, b: GlyphBox): boolean {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const height = Math.min(a[3] - a[1], b[3] - b[1]);
  return overlap > height / 2;
}
