import {
  StateEffect,
  StateField,
  type EditorState,
  type Transaction,
} from "@codemirror/state";

/** The editor gained (`true`) or lost (`false`) focus. */
export const setEditorFocus = StateEffect.define<boolean>();

/**
 * Whether the editor has focus, kept in the state so that block decorations
 * (a state field) can depend on it. CodeMirror adds the effect to a
 * transaction of its own whenever focus changes.
 */
export const editorFocus = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let focused = value;
    for (const effect of tr.effects) {
      if (effect.is(setEditorFocus)) {
        focused = effect.value;
      }
    }
    return focused;
  },
});

/**
 * Whether the editor has focus. A state that does not track it (one built
 * outside an editor, as in unit tests) counts as focused, so the reveal
 * rules apply to it unchanged.
 */
export function hasEditorFocus(state: EditorState): boolean {
  return state.field(editorFocus, false) ?? true;
}

export function editorFocusToggled(tr: Transaction): boolean {
  return (
    tr.startState.field(editorFocus, false) !==
    tr.state.field(editorFocus, false)
  );
}
