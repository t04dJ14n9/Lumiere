import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
} from "@codemirror/state";

interface LineSpan {
  from: number;
  to: number;
}

/**
 * The whole lines of every selection range, from the start of its first line
 * to the end of its last (a line it ends at the start of included, as in
 * Obsidian), in document order. Spans that share a line are one span: two
 * carets on a line, or ranges whose first and last lines meet, would
 * otherwise each put a block around the same text.
 */
function selectedLineSpans(state: EditorState): LineSpan[] {
  const spans: LineSpan[] = [];
  // Selection ranges are sorted by their start and never overlap.
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).from;
    const to = state.doc.lineAt(range.to).to;
    const last = spans.at(-1);
    if (last && from <= last.to) {
      last.to = Math.max(last.to, to);
    } else {
      spans.push({ from, to });
    }
  }
  return spans;
}

/**
 * `open` and `close` lines around the lines of every selection, as
 * Obsidian's Insert Code Block and Insert Math Block put them: one block
 * around the selections that share a line, and every selection staying on
 * its text.
 */
export function fenceSelectedLines(
  state: EditorState,
  open: string,
  close: string,
): { changes: ChangeSpec; selection: EditorSelection } {
  const before = `${open}\n`;
  const after = `\n${close}`;
  const spans = selectedLineSpans(state);
  const ranges = state.selection.ranges.map((range) => {
    // A range lies in one span: the first that does not end before it.
    const index = spans.findIndex((span) => range.to <= span.to);
    const shift = index * (before.length + after.length) + before.length;
    return EditorSelection.range(range.anchor + shift, range.head + shift);
  });
  return {
    changes: spans.flatMap(({ from, to }) => [
      { from, insert: before },
      { from: to, insert: after },
    ]),
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
  };
}
