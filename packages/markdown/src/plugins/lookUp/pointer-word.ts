import { selectedWord, wordAround } from "./words";

/** A point in the note's window, in client (viewport) coordinates. */
export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The word the reader means when the note's menu opens at `point`: the
 * selection when it is one word in `content`, else the word drawn under
 * the point, else "".
 */
export function menuWord(content: HTMLElement, point: ClientPoint): string {
  return selectionWord(content) || wordAtPoint(content, point);
}

/** The selection as one word, when it lies in `content`; "" otherwise. */
export function selectionWord(content: HTMLElement): string {
  const selection = content.ownerDocument.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !content.contains(selection.anchorNode) ||
    !content.contains(selection.focusNode)
  ) {
    return "";
  }
  return selectedWord(selection.toString());
}

/**
 * The word drawn under `point` in `content`, read from the rendered text the
 * way macOS Look Up reads it: a link's label, not its source, and no hidden
 * Markdown markers. "" over spaces, past the end of a line, and outside
 * `content`.
 */
export function wordAtPoint(content: HTMLElement, point: ClientPoint): string {
  const caret = content.ownerDocument.caretRangeFromPoint(point.x, point.y);
  const node = caret?.startContainer;
  if (!caret || !(node instanceof Text) || !content.contains(node)) {
    return "";
  }
  // The caret falls between two characters, or at the end of the line when
  // the point is past it: the word is the one whose glyph is under the point.
  const index = [caret.startOffset, caret.startOffset - 1].find((candidate) =>
    isGlyphUnder(node, candidate, point),
  );
  return index === undefined ? "" : wordAround(node.data, index);
}

function isGlyphUnder(node: Text, index: number, point: ClientPoint): boolean {
  if (index < 0 || index >= node.data.length) {
    return false;
  }
  const glyph = node.ownerDocument.createRange();
  glyph.setStart(node, index);
  glyph.setEnd(node, index + 1);
  // Per box, not the bounding box: at a soft wrap the range can report a box
  // on each line, and their union would cover text that is not this glyph.
  return [...glyph.getClientRects()].some(
    (box) =>
      point.x >= box.left &&
      point.x <= box.right &&
      point.y >= box.top &&
      point.y <= box.bottom,
  );
}
