import type { EditorView } from "@codemirror/view";
import type { Logger } from "@workshop/core";
import type { RenderPass, RenderService } from "../render/api";

interface CellRender {
  pass?: RenderPass;
  abort: AbortController;
  /** The cell's text, as rendered. */
  source: string;
  /** The note line the cell is on, kept on the pass once it exists. */
  sourceLine: number;
}

/** Cancels stale cell renders before a cell editor takes ownership of its DOM. */
export class TableContent {
  private readonly passes = new Map<HTMLElement, CellRender>();
  private live = true;
  constructor(
    private readonly view: EditorView,
    private readonly render: RenderService,
    private readonly logger: Logger,
  ) {}
  disposeContent(element: HTMLElement): void {
    const entry = this.passes.get(element);
    entry?.abort.abort();
    this.passes.delete(element);
    void entry?.pass?.dispose();
  }
  renderContent(element: HTMLElement, source: string, offset: number): void {
    this.disposeContent(element);
    const entry: CellRender = {
      abort: new AbortController(),
      source,
      sourceLine: this.lineAt(offset),
    };
    this.passes.set(element, entry);
    void this.render
      .into(element, displayedCell(source), {
        signal: entry.abort.signal,
        sourceLine: entry.sourceLine,
        measure: () => {
          if (this.live && element.isConnected) {
            this.view.requestMeasure();
          }
        },
      })
      .then((pass) => {
        if (!this.live || this.passes.get(element) !== entry) {
          void pass.dispose();
        } else {
          // The cell may have moved to another line while it rendered.
          pass.sourceLine = entry.sourceLine;
          entry.pass = pass;
        }
      })
      .catch((error) => this.logger.error("Table rendering failed", error));
  }

  /** The text rendered into `element`, or undefined when it holds none. */
  renderedSource(element: HTMLElement): string | undefined {
    return this.passes.get(element)?.source;
  }

  /**
   * Keep `element`'s rendering for a cell of the same text that is now at
   * `offset`. Its pass takes the new line: a task box in the cell writes to
   * the line the pass names when it is clicked.
   */
  moveContent(element: HTMLElement, offset: number): void {
    const entry = this.passes.get(element);
    if (!entry) {
      return;
    }
    entry.sourceLine = this.lineAt(offset);
    if (entry.pass) {
      entry.pass.sourceLine = entry.sourceLine;
    }
  }

  dispose(): void {
    this.live = false;
    for (const element of this.passes.keys()) {
      this.disposeContent(element);
    }
  }

  private lineAt(offset: number): number {
    return this.view.state.doc.lineAt(offset).number - 1;
  }
}

/**
 * GFM removes the backslash of an escaped pipe before parsing a cell, even
 * inside code spans, so `` `a \| b` `` shows `a | b`. The cell editor keeps
 * the escape; only the rendered cell drops it.
 */
export function displayedCell(source: string): string {
  return source.replace(/\\\|/g, "|");
}
