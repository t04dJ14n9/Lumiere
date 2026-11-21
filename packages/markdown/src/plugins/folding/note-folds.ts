import { EditorView } from "@codemirror/view";
import type { Context } from "@workshop/core";
import type {} from "../editor/api";
import { MAX_SAVED_FOLDS, protocol, type SavedFold } from "./protocol";
import { changesFolds, foldedViewState } from "./view-state";

/** Obsidian saves a note's folds half a second after they change. */
export const SAVE_DELAY_MS = 500;

interface FoldSaverOptions {
  capture(): SavedFold[];
  /** Answers whether the note took the folds. */
  send(folds: SavedFold[], claim: boolean): Promise<boolean>;
  after(ms: number, run: () => void): () => void;
}

/**
 * When a panel sends its folds to be the note's: after the reader folds or
 * unfolds in it (a claim), and after the text changes while the note last
 * took this panel's folds, since their offsets move with the text. Once the
 * note turns an update down (another panel's folds are the note's now),
 * only the reader's next fold here sends again.
 */
export class FoldSaver {
  private claim = false;
  private isNoteWriter = true;
  private sent: string;
  private cancel: (() => void) | undefined;

  constructor(private readonly options: FoldSaverOptions) {
    this.sent = JSON.stringify(options.capture());
  }

  /** The folds shown now are the note's, as loaded: nothing to send. */
  loaded(): void {
    this.sent = JSON.stringify(this.options.capture());
  }

  folded(): void {
    this.claim = true;
    this.isNoteWriter = true;
    this.schedule();
  }

  textChanged(): void {
    if (this.isNoteWriter) {
      this.schedule();
    }
  }

  /** Send now what is waiting (the panel is going away). */
  flush(): void {
    if (this.cancel) {
      this.save();
    }
  }

  dispose(): void {
    this.cancel?.();
    this.cancel = undefined;
  }

  private schedule(): void {
    this.cancel?.();
    this.cancel = this.options.after(SAVE_DELAY_MS, () => this.save());
  }

  private save(): void {
    this.dispose();
    const folds = this.options.capture().slice(0, MAX_SAVED_FOLDS);
    const text = JSON.stringify(folds);
    if (!this.claim && text === this.sent) {
      return;
    }
    const claim = this.claim;
    this.claim = false;
    this.sent = text;
    let sending: Promise<boolean>;
    try {
      sending = this.options.send(folds, claim);
    } catch {
      // A panel going away may no longer reach its host.
      return;
    }
    void sending.then(
      (taken) => {
        if (!taken && !this.claim) {
          this.isNoteWriter = false;
        }
      },
      () => {},
    );
  }
}

/**
 * The note's folds, as Obsidian keeps them per file: put back when the panel
 * opens, and saved as the reader changes them (see `NoteFoldStore`).
 */
export function registerNoteFolds(ctx: Context): void {
  const view = ctx.editor.view;
  const saver = new FoldSaver({
    capture: () => foldedViewState.capture(view),
    send: (folds, claim) => ctx.rpc.call(protocol, "save", { folds, claim }),
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  let isTouched = false;
  ctx.effect(() =>
    ctx.editor.extend(
      EditorView.updateListener.of((update) => {
        if (update.transactions.some(changesFolds)) {
          isTouched = true;
          saver.folded();
        } else if (update.docChanged) {
          saver.textChanged();
        }
      }),
    ),
  );
  ctx.effect(() => {
    // The page going away (the panel closing) sends what is still waiting.
    const page = globalThis as Partial<
      Pick<Window, "addEventListener" | "removeEventListener">
    >;
    const flush = () => saver.flush();
    page.addEventListener?.("pagehide", flush);
    return () => {
      page.removeEventListener?.("pagehide", flush);
      saver.flush();
      saver.dispose();
    };
  });
  void ctx.rpc
    .call(protocol, "load", {})
    .then(({ folds }) => {
      // A fold the reader made while the record was on its way wins.
      if (!ctx.isLive || isTouched || !folds) {
        return;
      }
      foldedViewState.restore(view, folds);
      saver.loaded();
    })
    .catch((error) => ctx.logger.warn("Saved folds unavailable", error));
}
