import type { EditorState, TransactionSpec } from "@codemirror/state";

/**
 * Insert Wikilink and Insert Embed, as in Obsidian: the selection goes
 * between `[[` and `]]` (`![[` for an embed), the caret after it, ready for
 * a heading or an alias. The edit asks for suggestions, so the list of notes
 * opens at once.
 */
export function wikilinkEdit(
  state: EditorState,
  embed: boolean,
): TransactionSpec {
  const { from, to } = state.selection.main;
  const open = embed ? "![[" : "[[";
  const text = state.sliceDoc(from, to);
  return {
    changes: { from, to, insert: `${open}${text}]]` },
    selection: { anchor: from + open.length + text.length },
    userEvent: "input.autocomplete",
  };
}
