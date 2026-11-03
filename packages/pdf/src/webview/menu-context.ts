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
 * `hasAnnotationSelection` gates Delete Annotation so a plain text/region
 * selection does not show a no-op Delete (mixed-mark / click-miss case).
 */
const CONTEXT_ATTRIBUTE = "data-vscode-context";

export type MenuSelectionState = {
  hasSelection: boolean;
  hasAnnotationSelection: boolean;
};

/** The `data-vscode-context` value for a menu opened now. */
export function menuContext(state: MenuSelectionState): string {
  return JSON.stringify({
    [`${SETTING_PREFIX}hasSelection`]: state.hasSelection,
    [`${SETTING_PREFIX}hasAnnotationSelection`]: state.hasAnnotationSelection,
  });
}

/** Keep the attribute current for every context menu; returns how to stop. */
export function followMenuContext(
  doc: Pick<Document, "body" | "addEventListener" | "removeEventListener">,
  state: () => MenuSelectionState,
): () => void {
  const update = (): void => {
    doc.body.setAttribute(CONTEXT_ATTRIBUTE, menuContext(state()));
  };
  // A capture listener on the document runs before VS Code's on the window.
  doc.addEventListener("contextmenu", update, true);
  return () => doc.removeEventListener("contextmenu", update, true);
}
