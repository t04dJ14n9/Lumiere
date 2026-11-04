import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";

/** A scroll is reported once it has paused this long. */
export const READING_REPORT_MS = 100;

/**
 * Where the reader is for scroll follow: the start of the line at the top
 * of the editor viewport. Caret follow stays on `followCaret` /
 * `editor/selectionChanged`; this offset is only for scroll reporting.
 * A 1px inset avoids picking the previous line when the boundary sits
 * exactly on a line edge.
 */
export function readingOffset(view: EditorView): number {
  const box = view.scrollDOM.getBoundingClientRect();
  const top = box.top - view.documentTop;
  return view.lineBlockAtHeight(top + 1).from;
}

/**
 * Reports the reading position after each scroll, once it changes. A caret
 * move forgets the last report: the outline followed the caret then, so
 * the next scroll reports again even to the same place.
 */
export function readingPositionReporter(
  report: (view: EditorView, offset: number) => void,
): Extension {
  return ViewPlugin.define((view) => {
    let last: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      timer = undefined;
      const offset = readingOffset(view);
      if (offset !== last) {
        last = offset;
        report(view, offset);
      }
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(send, READING_REPORT_MS);
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return {
      update(update) {
        if (update.selectionSet || update.docChanged) {
          last = undefined;
        }
      },
      destroy() {
        clearTimeout(timer);
        view.scrollDOM.removeEventListener("scroll", onScroll);
      },
    };
  });
}
