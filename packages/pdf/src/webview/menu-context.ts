import { SETTING_PREFIX } from "../shared/setting-schema";

/**
 * VS Code builds a webview's context menu from the `data-vscode-context` of
 * the clicked element and its ancestors, read by its own `contextmenu`
 * listener on the window. The global `lumiere.pdf.hasSelection` key comes
 * from the extension only after the viewer has read the selected text, so a
 * right-click made just after a drag opens the menu before it: the text
 * looks selected but Copy Link for Agent, the menu's only way to it, is
 * missing. So the document carries the selection as it is when the menu
 * opens; that per-menu context shadows the global key.
 *
 * `hasTextSelection` shows Highlight, Add Annotation… and Mark Text, which
 * need selected text (a region has none to mark). `hasAnnotationSelection`
 * shows Edit Note…, Change Color and Delete Annotation: the menu was opened
 * on one of Lumiere's marks (`mark-menu.ts`).
 */
const CONTEXT_ATTRIBUTE = "data-vscode-context";

export type MenuSelectionState = {
  hasSelection: boolean;
  hasTextSelection: boolean;
  hasAnnotationSelection: boolean;
};

/** The `data-vscode-context` value for a menu opened now. */
export function menuContext(state: MenuSelectionState): string {
  return JSON.stringify({
    [`${SETTING_PREFIX}hasSelection`]: state.hasSelection,
    [`${SETTING_PREFIX}hasTextSelection`]: state.hasTextSelection,
    [`${SETTING_PREFIX}hasAnnotationSelection`]: state.hasAnnotationSelection,
  });
}

/**
 * Keep the attribute current for every context menu; returns how to stop.
 * `state` gets the menu's event: where it was opened says which mark it is for.
 */
export function followMenuContext(
  doc: Pick<Document, "body" | "addEventListener" | "removeEventListener">,
  state: (event: MouseEvent) => MenuSelectionState,
): () => void {
  const update = (event: MouseEvent): void => {
    doc.body.setAttribute(CONTEXT_ATTRIBUTE, menuContext(state(event)));
  };
  // A capture listener on the document runs before VS Code's on the window.
  doc.addEventListener("contextmenu", update, true);
  return () => doc.removeEventListener("contextmenu", update, true);
}
