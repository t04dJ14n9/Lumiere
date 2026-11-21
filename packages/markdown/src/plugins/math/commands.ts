import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";

/** Inline math around the selection, or off when `$` already surrounds it. */
export function inlineMathEdit(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  if (
    from > 0 &&
    state.sliceDoc(from - 1, from) === "$" &&
    state.sliceDoc(to, to + 1) === "$"
  ) {
    return {
      changes: [
        { from: from - 1, to: from, insert: "" },
        { from: to, to: to + 1, insert: "" },
      ],
      selection: { anchor: from - 1, head: to - 1 },
      userEvent: "input.math",
    };
  }
  return {
    changes: { from, to, insert: `$${selected}$` },
    selection: { anchor: from + 1, head: from + 1 + selected.length },
    userEvent: "input.math",
  };
}

/**
 * Insert Math Block, as in Obsidian: `$$` lines go around the lines of every
 * selection (an empty line becomes the formula's), and each selection stays
 * on its text. A selection ending at the start of a line includes that line,
 * as in Obsidian.
 */
export function mathBlockEdit(state: EditorState): TransactionSpec {
  return {
    ...state.changeByRange(({ from, to, anchor, head }) => ({
      changes: [
        { from: state.doc.lineAt(from).from, insert: "$$\n" },
        { from: state.doc.lineAt(to).to, insert: "\n$$" },
      ],
      range: EditorSelection.range(anchor + 3, head + 3),
    })),
    userEvent: "input.math",
  };
}
