import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { ensureSyntaxTree, language, syntaxTree } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import {
  documentTree,
  FIRST_PAINT_PARSE_CHARS,
  languageTree,
  replaceDocumentTree,
} from "./api";
import { backgroundUpdate } from "../editor/api";

export { documentTree, FIRST_PAINT_PARSE_CHARS, replaceDocumentTree };

/**
 * Characters past the viewport parsed together with it, so the next few
 * scroll steps find their syntax ready and do not each publish a tree.
 */
export const PARSE_AHEAD_CHARS = 10000;
/** The longest background slice; a shorter idle period ends it sooner. */
const IDLE_SLICE_MS = 5;
/** Run a slice at least this often, even while the page never idles. */
const IDLE_TIMEOUT_MS = 50;

/** Runs background slices; each gets a time budget in milliseconds. */
export interface IdleScheduler {
  request(slice: (budget: number) => void): () => void;
}

/** What the parser reads from and writes to its editor. */
export type ParsedView = Pick<EditorView, "state" | "viewport" | "dispatch">;

/**
 * Keeps Live Preview's tree of a large note ahead of the viewport and
 * finishes it in the background, on CodeMirror's own parse (one parse of
 * the note, kept by CodeMirror's language; see `documentTree`).
 *
 * While the tree is a prefix, a viewport that passes its end has the parse
 * pushed at once, up to the viewport and a margin: those lines need their
 * syntax this frame. The rest is parsed in short idle slices, scrolling or
 * not, and published when complete; CodeMirror's own background parse,
 * which stops 100,000 characters past the viewport, works on the same parse
 * between them. An edit hands the parse on to the next document version
 * (CodeMirror reuses every block it did not touch), so nothing restarts
 * from the top.
 */
export class DocumentTreeParser {
  private cancelSlice: (() => void) | undefined;
  private isCatchUpQueued = false;
  private isDestroyed = false;

  constructor(
    private readonly view: ParsedView,
    private readonly scheduler: IdleScheduler = browserIdleScheduler(),
  ) {
    this.keepUp();
  }

  update(_update: ViewUpdate): void {
    this.keepUp();
  }

  destroy(): void {
    this.isDestroyed = true;
    this.cancelSlice?.();
    this.cancelSlice = undefined;
  }

  private get tree(): Tree {
    return this.view.state.field(documentTree);
  }

  private keepUp(): void {
    const { state, viewport } = this.view;
    if (!state.facet(language)) {
      return;
    }
    if (viewport.to > this.tree.length || this.isAheadOfCodeMirror()) {
      this.queueCatchUp();
    }
    if (this.tree.length >= state.doc.length) {
      this.cancelSlice?.();
      this.cancelSlice = undefined;
    } else {
      this.scheduleSlice();
    }
  }

  /**
   * Whether Live Preview made CodeMirror's parse reach further than the
   * tree CodeMirror's state holds (inside an edit, which cannot dispatch):
   * one more transaction hands it to CodeMirror's own readers.
   */
  private isAheadOfCodeMirror(): boolean {
    const { state } = this.view;
    return (
      syntaxTree(state).length < this.tree.length &&
      // The tree CodeMirror's parse holds, published in its state or not.
      ensureSyntaxTree(state, 0, 0) === this.tree
    );
  }

  /** A view update cannot dispatch, so the catch-up runs right after it. */
  private queueCatchUp(): void {
    if (this.isCatchUpQueued) {
      return;
    }
    this.isCatchUpQueued = true;
    queueMicrotask(() => {
      this.isCatchUpQueued = false;
      this.catchUpWithViewport();
    });
  }

  private catchUpWithViewport(): void {
    if (this.isDestroyed) {
      return;
    }
    const { state, viewport } = this.view;
    if (viewport.to > this.tree.length) {
      const tree = languageTree(state, viewport.to + PARSE_AHEAD_CHARS);
      if (tree !== this.tree) {
        this.publish(tree);
        return;
      }
    }
    if (this.isAheadOfCodeMirror()) {
      this.view.dispatch({ annotations: backgroundUpdate.of(true) });
    }
  }

  private scheduleSlice(): void {
    if (this.cancelSlice || this.isDestroyed) {
      return;
    }
    this.cancelSlice = this.scheduler.request((budget) => {
      this.cancelSlice = undefined;
      const { state } = this.view;
      if (this.isDestroyed || this.tree.length >= state.doc.length) {
        return;
      }
      // At least one block per slice, however short the budget.
      const done = ensureSyntaxTree(state, state.doc.length, budget);
      if (done) {
        this.publish(done);
      } else {
        this.scheduleSlice();
      }
    });
  }

  private publish(tree: Tree): void {
    this.view.dispatch({
      effects: replaceDocumentTree.of(tree),
      annotations: backgroundUpdate.of(true),
    });
  }
}

/** Idle callbacks where the browser has them; short timeouts otherwise. */
function browserIdleScheduler(): IdleScheduler {
  if (typeof requestIdleCallback === "function") {
    return {
      request(slice) {
        const handle = requestIdleCallback(
          (deadline) =>
            slice(
              deadline.didTimeout
                ? IDLE_SLICE_MS
                : Math.min(IDLE_SLICE_MS, deadline.timeRemaining()),
            ),
          { timeout: IDLE_TIMEOUT_MS },
        );
        return () => cancelIdleCallback(handle);
      },
    };
  }
  return {
    request(slice) {
      const handle = setTimeout(() => slice(IDLE_SLICE_MS), 0);
      return () => clearTimeout(handle);
    },
  };
}

export const documentTreeParser = ViewPlugin.fromClass(DocumentTreeParser);
