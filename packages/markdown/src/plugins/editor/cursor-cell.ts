import { findClusterBreak, type Text } from "@codemirror/state";
import { caretCharacterPosition } from "./caret";

export interface Span {
  from: number;
  to: number;
}

/** The character from `position`: one grapheme, or the line break. */
function cellAt(doc: Text, position: number): Span {
  if (position >= doc.length) {
    return { from: position, to: position };
  }
  const line = doc.lineAt(position);
  if (position === line.to) {
    return { from: position, to: position + 1 };
  }
  const end = findClusterBreak(line.text, position - line.from);
  return { from: position, to: line.from + end };
}

/**
 * The parts of a range the selection tints. In Vim's visual mode the block
 * cursor shows the character it is on, so the tint leaves that character to
 * it: back on the character where the selection started, only the cursor
 * shows, as in VS Code.
 */
export function tintedSpans(
  doc: Text,
  range: { anchor: number; head: number; from: number; to: number },
  visual: boolean,
): Span[] {
  if (!visual || range.from === range.to) {
    return range.from === range.to ? [] : [{ from: range.from, to: range.to }];
  }
  const cell = cellAt(doc, caretCharacterPosition(doc, range, "visual"));
  return [
    { from: range.from, to: Math.max(range.from, cell.from) },
    { from: Math.min(range.to, cell.to), to: range.to },
  ].filter((span) => span.to > span.from);
}
