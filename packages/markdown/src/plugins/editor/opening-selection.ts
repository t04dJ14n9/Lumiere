import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export interface OpeningSelection {
  anchor: number;
  head: number;
  /**
   * 0-based source line that must stay at the top of the viewport after open
   * (reclaim / Chat dismiss). When set, scroll uses y:"start" instead of
   * centering the selection.
   */
  topLine?: number;
}

/**
 * The range a Search match should already occupy when the editor is created.
 * A caret at offset 0 is the default empty editor, not a match — unless a
 * topLine asks to preserve the native viewport.
 */
export function openingEditorSelection(
  length: number,
  selection: OpeningSelection | undefined,
): OpeningSelection | undefined {
  if (!selection) {
    return undefined;
  }
  const anchor = clampOffset(selection.anchor, length);
  const head = clampOffset(selection.head, length);
  if (anchor === 0 && head === 0 && selection.topLine === undefined) {
    return undefined;
  }
  return {
    anchor,
    head,
    ...(selection.topLine !== undefined ? { topLine: selection.topLine } : {}),
  };
}

/**
 * Select and scroll before the browser paints. Search matches center; a
 * transferred topLine pins that source line to the top of the viewport.
 */
export function placeOpeningSelection(
  view: EditorView,
  selection: OpeningSelection | undefined,
): void {
  const opening = openingEditorSelection(view.state.doc.length, selection);
  if (!opening) {
    return;
  }
  const effects = [];
  if (opening.topLine !== undefined) {
    const lineNumber = Math.min(
      Math.max(opening.topLine, 0) + 1,
      view.state.doc.lines,
    );
    effects.push(
      EditorView.scrollIntoView(view.state.doc.line(lineNumber).from, {
        y: "start",
      }),
    );
  } else {
    const range = EditorSelection.range(opening.anchor, opening.head);
    effects.push(EditorView.scrollIntoView(range, { y: "center" }));
  }
  view.dispatch({
    selection: { anchor: opening.anchor, head: opening.head },
    effects,
  });
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return 0;
  }
  return Math.min(offset, length);
}
