import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";

/** A scroll is reported once it has paused this long. */
export const READING_REPORT_MS = 100;

/**
 * A scroll this soon after the caret moved is the editor keeping the caret in
 * view (an arrow past the edge, Page Down, Ctrl+End, a find match) or a jump
 * placing its target, not the reader scrolling. The scroll event comes a
 * frame or two after the dispatch that caused it; this leaves room for a
 * busy page.
 */
export const CARET_SCROLL_MS = 250;

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

interface ReadingReporterOptions {
  /** Where the reader is now. */
  read(): number;
  report(offset: number): void;
}

/**
 * Decides when a scroll tells the outline where the reader is. The outline
 * also follows the caret, and the caret wins: a scroll the caret caused
 * (see `CARET_SCROLL_MS`) is not the reader moving on, and reporting it would
 * select the section at the top of the viewport right after the caret follow
 * selected the caret's own. A burst of scrolls is reported once it pauses,
 * and only if the reader scrolled during it.
 */
export class ReadingReporter {
  /** The last position seen, reported or not; undefined when it is stale. */
  private last: number | undefined;
  private caretMovedAt = Number.NEGATIVE_INFINITY;
  private hasReaderScrolled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ReadingReporterOptions) {}

  /**
   * The selection was set. The outline followed the caret, so the next
   * scroll reports again even to the position last reported, and a scroll
   * of the reader's that is still waiting to be reported is older than the
   * caret now.
   */
  caretMoved(): void {
    this.last = undefined;
    this.hasReaderScrolled = false;
    this.caretMovedAt = Date.now();
  }

  /** Offsets from before an edit no longer mean the same place. */
  documentChanged(): void {
    this.last = undefined;
  }

  scrolled(): void {
    if (Date.now() - this.caretMovedAt > CARET_SCROLL_MS) {
      this.hasReaderScrolled = true;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settle(), READING_REPORT_MS);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private settle(): void {
    this.timer = undefined;
    const hasReaderScrolled = this.hasReaderScrolled;
    this.hasReaderScrolled = false;
    const offset = this.options.read();
    if (offset === this.last) {
      return;
    }
    // A scroll the caret caused is remembered too: layout that shifts later
    // (an image loading) must not report the same top line as news.
    this.last = offset;
    if (hasReaderScrolled) {
      this.options.report(offset);
    }
  }
}

/** Reports the reading position after each scroll, once it changes. */
export function readingPositionReporter(
  report: (view: EditorView, offset: number) => void,
): Extension {
  return ViewPlugin.define((view) => {
    const reporter = new ReadingReporter({
      read: () => readingOffset(view),
      report: (offset) => report(view, offset),
    });
    const onScroll = () => reporter.scrolled();
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return {
      update(update) {
        if (update.docChanged) {
          reporter.documentChanged();
        }
        if (update.selectionSet) {
          reporter.caretMoved();
        }
      },
      destroy() {
        reporter.dispose();
        view.scrollDOM.removeEventListener("scroll", onScroll);
      },
    };
  });
}
