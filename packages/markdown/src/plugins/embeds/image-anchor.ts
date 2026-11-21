import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownTree } from "../livePreview/api";
import { embedsNote } from "./clicks";
import { isSelectableImage } from "./image-resize-corner";

export interface Range {
  from: number;
  to: number;
}

/**
 * The class of an image drawn just after its shown source, in a line of
 * text. CodeMirror reports a drawn image at the start of its widget: the
 * embed's start for an image drawn in place of its source, the embed's end
 * for one drawn after it. Two abutting images (`![[a.png]]![[b.png]]`)
 * share a position, the end of one being the start of the other, so the
 * class tells which is meant.
 */
export const IMAGE_AFTER_SOURCE = "md-image-after-source";

/**
 * Rendered blocks whose images belong to that block (a rendered callout,
 * quote, list or table), not to an image embed of their own.
 */
export const FOREIGN_IMAGE_HOSTS =
  ".hybrid-Callout, .hybrid-Blockquote, .hybrid-BulletList, .hybrid-OrderedList, .cm-table-widget";

/** The image embeds (`![[a.png]]`, `![](a.png)`) on the line holding `at`. */
export function imagesOnLine(state: EditorState, at: number): Range[] {
  const line = state.doc.lineAt(at);
  const found: Range[] = [];
  markdownTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (!["WikiEmbed", "Image"].includes(node.name)) {
        return true;
      }
      if (!embedsNote(state.sliceDoc(node.from, node.to))) {
        found.push({ from: node.from, to: node.to });
      }
      return false;
    },
  });
  return found;
}

/**
 * The embed whose image is drawn at `at`. An image alone on its line is a
 * block, drawn over the whole line (trailing spaces included) or below it,
 * so it is that line's only image. One in a line of text starts at `at`,
 * or ends there when drawn after its source.
 */
export function embedDrawnAt(
  state: EditorState,
  at: number,
  drawn: { isBlock: boolean; isAfterSource: boolean },
): Range | undefined {
  const images = imagesOnLine(state, at);
  if (drawn.isBlock) {
    return images.length === 1 ? images[0] : undefined;
  }
  return drawn.isAfterSource
    ? images.find((range) => range.to === at)
    : images.find((range) => range.from === at);
}

/** The embed a rendered image in the editor shows, if it is an image embed's. */
export function embedOfImage(
  view: EditorView,
  image: HTMLImageElement,
): Range | undefined {
  if (!isSelectableImage(image) || image.closest(FOREIGN_IMAGE_HOSTS)) {
    return undefined;
  }
  let at: number;
  try {
    at = view.posAtDOM(image);
  } catch {
    return undefined;
  }
  return embedDrawnAt(view.state, at, {
    isBlock: !image.closest(".cm-line"),
    isAfterSource: Boolean(image.closest(`.${IMAGE_AFTER_SOURCE}`)),
  });
}
