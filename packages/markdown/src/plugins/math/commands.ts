import type { EditorState, TransactionSpec } from "@codemirror/state";
import { fenceSelectedLines } from "../../markdown/fence-lines";

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
 * as in Obsidian. Selections that share a line share one block.
 */
export function mathBlockEdit(state: EditorState): TransactionSpec {
  return { ...fenceSelectedLines(state, "$$", "$$"), userEvent: "input.math" };
}
