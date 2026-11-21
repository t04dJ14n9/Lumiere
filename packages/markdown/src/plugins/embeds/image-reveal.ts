import type { EditorState } from "@codemirror/state";
import type { WidgetType } from "@codemirror/view";
import type { InlineContext } from "../livePreview/api";

interface Range {
  from: number;
  to: number;
}

/**
 * Whether an image's source shows, as Obsidian 1.12 and earlier showed it
 * (owner request 2026-11-21; 1.13 keeps images rendered): a selection
 * touches it, by the rule every inline element follows (its chain of
 * abutting elements included); the find bar's match is a selection.
 *
 * With or without the editor's focus, as links reveal, not only while
 * focused as display math does: an image's own controls take the focus
 * (its inspector, its ⤢ button), and a reveal that ended with the focus
 * would draw the image again under them, closing the inspector it opened.
 */
export function isImageSourceShown(
  cx: Pick<InlineContext, "revealed">,
  range: Range,
): boolean {
  return cx.revealed(range.from, range.to);
}

export interface ImageDrawing {
  /** A rendered image of the embed, in place of its source or after it. */
  image(isAfterSource: boolean): WidgetType;
  /**
   * Whether the image is alone on its line in a block whose source is
   * revealed: Live Preview then draws the image below that source.
   */
  isInRevealedBlock(state: EditorState, range: Range): boolean;
}

/**
 * An image embed in a line of text: rendered in place of its source, or,
 * while its source shows, rendered again just after it. An image alone on
 * its line is a block, whose image Live Preview draws below the revealed
 * source; that block may reveal for a caret on its line's trailing spaces
 * too, so the line decides whether to ask.
 */
export function decorateImage(
  cx: InlineContext,
  node: Range,
  drawing: ImageDrawing,
): void {
  const { state } = cx;
  const isShown = isImageSourceShown(cx, node);
  const lines = {
    from: state.doc.lineAt(node.from).from,
    to: state.doc.lineAt(node.to).to,
  };
  // Asking the block index costs a walk of it: only near a selection.
  const inBlock =
    (isShown || isImageSourceShown(cx, lines)) &&
    drawing.isInRevealedBlock(state, node);
  if (inBlock) {
    return;
  }
  if (!isShown) {
    cx.replace(node.from, node.to, drawing.image(false));
    return;
  }
  // A node across two visible ranges is decorated twice; draw it once.
  const { visible } = cx;
  if (visible && (node.to < visible.from || node.to > visible.to)) {
    return;
  }
  cx.widgetAfter(node.to, drawing.image(true));
}
