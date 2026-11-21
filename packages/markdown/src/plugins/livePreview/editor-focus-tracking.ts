import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { editorFocus, setEditorFocus } from "./editor-focus";

/**
 * The field starts unfocused. Installed into an editor that already has
 * focus (Live Preview turned on from Source mode, a plugin restarted),
 * CodeMirror reports no change, so the plugin says so once. It cannot
 * dispatch during the update that installs it.
 */
const initialFocus = ViewPlugin.define((view) => {
  let isLive = true;
  if (view.hasFocus) {
    queueMicrotask(() => {
      if (isLive && view.hasFocus && !view.state.field(editorFocus, false)) {
        view.dispatch({ effects: setEditorFocus.of(true) });
      }
    });
  }
  return {
    destroy() {
      isLive = false;
    },
  };
});

export const editorFocusTracking: Extension = [
  editorFocus,
  EditorView.focusChangeEffect.of((_state, focusing) =>
    setEditorFocus.of(focusing),
  ),
  initialFocus,
];
