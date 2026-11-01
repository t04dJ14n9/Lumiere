/**
 * Re-attaching a sidecar highlight when the PDF's layout changed (a new
 * version of a paper): its quote is found again in the page's text, using
 * the text around it to choose between repeats, and its boxes are rebuilt
 * from the glyphs of the match. Pure; the viewer reads the page
 * (webview/sidecar-reattach.ts).
 */
import type { SegmentRect, SidecarHighlight } from "./sidecar-format";

/** Where two boxes may differ and still be the same place, in points. */
const SAME_PLACE = 2;

/** Left, top, right, bottom in points, as glyph boxes come. */
export type GlyphBox = [number, number, number, number];

/**
 * The characters [start, end) of the page text where the highlight's quote
 * is now: the only occurrence, or the one whose surroundings match its
 * context best. Undefined when it is gone or the best is a tie.
 */
export function findQuote(
  pageText: string,
  highlight: Pick<SidecarHighlight, "quote" | "contextBefore" | "contextAfter">,
): { start: number; end: number } | undefined {
  const { quote, contextBefore, contextAfter } = highlight;
  if (!quote.trim()) {
    return undefined;
  }
  const scored: { start: number; score: number }[] = [];
  for (
    let at = pageText.indexOf(quote);
    at >= 0;
    at = pageText.indexOf(quote, at + 1)
  ) {
    const before = commonSuffix(pageText.slice(0, at), contextBefore);
    const after = commonPrefix(pageText.slice(at + quote.length), contextAfter);
    scored.push({ start: at, score: before + after });
  }
  scored.sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || (next && next.score === best.score)) {
    return undefined;
  }
  return { start: best.start, end: best.start + quote.length };
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

/**
 * Whether a highlight's boxes still lie over the glyphs of its quote: the
 * centre of every glyph is inside one of them. Its boxes came from the text
 * selection, which measures lines differently from glyphs, so this, not an
 * equality of boxes, says whether the highlight is still in place.
 */
export function coversGlyphs(
  rects: readonly SegmentRect[],
  boxes: readonly GlyphBox[],
): boolean {
  return boxes.every(([left, top, right, bottom]) => {
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    return rects.some(
      (rect) =>
        x >= rect.x - SAME_PLACE &&
        x <= rect.x + rect.w + SAME_PLACE &&
        y >= rect.y - SAME_PLACE &&
        y <= rect.y + rect.h + SAME_PLACE,
    );
  });
}

/** Whether two highlights' boxes are in the same place on the page. */
export function sameRects(
  a: readonly SegmentRect[],
  b: readonly SegmentRect[],
): boolean {
  return (
    a.length === b.length &&
    a.every((rect, index) => {
      const other = b[index]!;
      return (
        Math.abs(rect.x - other.x) <= SAME_PLACE &&
        Math.abs(rect.y - other.y) <= SAME_PLACE &&
        Math.abs(rect.w - other.w) <= SAME_PLACE &&
        Math.abs(rect.h - other.h) <= SAME_PLACE
      );
    })
  );
}

function overlapsVertically(a: GlyphBox, b: GlyphBox): boolean {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const height = Math.min(a[3] - a[1], b[3] - b[1]);
  return overlap > height / 2;
}

function commonSuffix(text: string, context: string): number {
  let length = 0;
  while (
    length < context.length &&
    length < text.length &&
    text[text.length - 1 - length] === context[context.length - 1 - length]
  ) {
    length++;
  }
  return length;
}

function commonPrefix(text: string, context: string): number {
  let length = 0;
  while (
    length < context.length &&
    length < text.length &&
    text[length] === context[length]
  ) {
    length++;
  }
  return length;
}
