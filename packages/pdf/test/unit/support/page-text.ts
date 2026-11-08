import type { GlyphBox } from "../../../src/shared/line-rects";

/** Width and line height of the glyph boxes `layOut` draws, in points. */
export const GLYPH_WIDTH = 8;
export const LINE_HEIGHT = 14;

/**
 * Glyph boxes for a page's text, one per UTF-16 unit like the page text:
 * a line of boxes per line of text, none for whitespace (PDFium gives the
 * "\r\n" between lines no box either). Column `c` of line `r` starts at
 * x = c * GLYPH_WIDTH and y = r * LINE_HEIGHT.
 */
export function layOut(pageText: string): (GlyphBox | undefined)[] {
  let line = 0;
  let column = 0;
  return Array.from({ length: pageText.length }, (_, index) => {
    const char = pageText.charAt(index);
    if (char === "\n") {
      line += 1;
      column = 0;
      return undefined;
    }
    const x = column * GLYPH_WIDTH;
    const y = line * LINE_HEIGHT;
    column += 1;
    return /\s/u.test(char)
      ? undefined
      : ([x, y, x + GLYPH_WIDTH - 1, y + LINE_HEIGHT - 2] as GlyphBox);
  });
}

/** The (line, column) of the first occurrence of `needle` in `pageText`. */
export function placeOf(
  pageText: string,
  needle: string,
): { line: number; column: number } {
  const before = pageText.slice(0, pageText.indexOf(needle));
  const lines = before.split("\n");
  return { line: lines.length - 1, column: lines.at(-1)!.length };
}
