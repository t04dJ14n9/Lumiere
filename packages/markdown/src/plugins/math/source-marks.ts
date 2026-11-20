import type { InlineContext } from "../livePreview/api";
import { delimiters, mathTokens } from "./source";

/**
 * Revealed math reads as highlighted code, its delimiters in the accent
 * colour, as in Obsidian. Only the visible part of the body is tokenised:
 * an unclosed `$$` makes the rest of the note one formula, and highlighting
 * all of it cost every keystroke the length of the note.
 */
export function markMathSource(
  cx: InlineContext,
  node: { from: number; to: number },
): void {
  const { from, to } = node;
  const doc = cx.state.doc;
  // The delimiters depend only on the first and last two characters.
  const head = doc.sliceString(from, Math.min(to, from + 2));
  const tail = doc.sliceString(Math.max(from + head.length, to - 2), to);
  const { width, closed } = delimiters(head + tail);
  const bodyEnd = closed ? to - width : to;
  const body = from + width;
  const shown = visibleLines(cx, body, bodyEnd);
  cx.mark(from, from + width, "md-math md-math-delimiter");
  if (shown.from < shown.to) {
    cx.mark(shown.from, shown.to, "md-math");
    for (const token of mathTokens(doc.sliceString(shown.from, shown.to))) {
      cx.mark(
        shown.from + token.from,
        shown.from + token.to,
        `md-math-${token.type}`,
      );
    }
  }
  if (closed) {
    cx.mark(bodyEnd, to, "md-math md-math-delimiter");
  }
}

/**
 * The lines of `from…to` on screen. A token never crosses a line break, so
 * tokenising whole lines highlights them as the whole body would.
 */
function visibleLines(
  cx: InlineContext,
  from: number,
  to: number,
): { from: number; to: number } {
  const { visible } = cx;
  if (!visible) {
    return { from, to };
  }
  const doc = cx.state.doc;
  return {
    from: Math.max(from, doc.lineAt(Math.max(from, visible.from)).from),
    to: Math.min(to, doc.lineAt(Math.min(to, visible.to)).to),
  };
}
