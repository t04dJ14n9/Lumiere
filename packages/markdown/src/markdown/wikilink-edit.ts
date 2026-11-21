import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";

/**
 * Insert Wikilink and Insert Embed, as in Obsidian: every selection goes
 * between `[[` and `]]` (`![[` for an embed), the caret after it, ready for
 * a heading or an alias. The edit asks for suggestions, so the list of notes
 * opens at once.
 */
export function wikilinkEdit(
  state: EditorState,
  embed: boolean,
): TransactionSpec {
  const open = embed ? "![[" : "[[";
  return {
    ...state.changeByRange(({ from, to }) => {
      const text = state.sliceDoc(from, to);
      return {
        changes: { from, to, insert: `${open}${text}]]` },
        range: EditorSelection.cursor(from + open.length + text.length),
      };
    }),
    userEvent: "input.autocomplete",
  };
}
