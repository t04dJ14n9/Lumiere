import type { EditorView } from "@codemirror/view";

const LINK = "a[href], [data-href]";

/**
 * The rendered link the caret is in, or touches: Preview Link at Caret
 * previews it. The DOM position may be the text inside the link or the line
 * around it, so the children on either side of the position count too.
 */
export function linkAtCaret(view: EditorView): HTMLElement | undefined {
  const { node, offset } = view.domAtPos(view.state.selection.main.head);
  for (const candidate of [
    node,
    node.childNodes[offset - 1],
    node.childNodes[offset],
  ]) {
    const element =
      candidate?.nodeType === 1
        ? (candidate as Element)
        : candidate?.parentElement;
    const link = element?.closest<HTMLElement>(LINK);
    if (link && view.contentDOM.contains(link)) {
      return link;
    }
  }
  return undefined;
}
