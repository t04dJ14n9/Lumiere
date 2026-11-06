/**
 * Page text and glyph boxes that line up character by character.
 *
 * PDFium counts a marker for a hyphen at the end of a line (U+FFFE) as a
 * glyph, and EmbedPDF strips such markers from the text it returns. A page
 * read in one piece is then shorter than its glyph list, and every box after
 * the first marker belongs to the character before the one it is paired with.
 */
import type { GlyphBox } from "./sidecar-reattach";

/**
 * Stands in for a glyph whose text was stripped. A soft hyphen is one of the
 * characters `foldText` drops, so it never takes part in a match, yet it keeps
 * every later character at its glyph's index.
 */
export const STRIPPED_GLYPH = "­";

export interface AlignedPageText {
  text: string;
  /** One box per UTF-16 unit of `text`; none where the glyph has no box. */
  boxes: (GlyphBox | undefined)[];
}

/**
 * Join each glyph's own text, read one glyph at a time, so `boxes[i]` is the
 * box of `text[i]`. A glyph that is several UTF-16 units long (a character
 * outside the BMP) lends its box to each of them.
 */
export function alignGlyphText(
  glyphTexts: readonly string[],
  glyphBoxes: readonly (GlyphBox | undefined)[],
): AlignedPageText {
  let text = "";
  const boxes: (GlyphBox | undefined)[] = [];
  glyphBoxes.forEach((box, index) => {
    const piece = glyphTexts[index] || STRIPPED_GLYPH;
    text += piece;
    for (let unit = 0; unit < piece.length; unit++) {
      boxes.push(box);
    }
  });
  return { text, boxes };
}
