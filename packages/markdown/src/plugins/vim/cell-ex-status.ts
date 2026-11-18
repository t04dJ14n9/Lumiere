import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { getCM, type CodeMirror } from "@replit/codemirror-vim";
import { syncVimPanel } from "./status-panel";

/** Matches @replit/codemirror-vim CodeMirror.state.statusbar under exactOptionalPropertyTypes. */
type StatusHost = {
  state: {
    statusbar?: Element | null;
    dialog?: Element | null;
    vimPlugin?: { updateStatus?: () => void };
  };
};

/**
 * Point a nested cell Vim adapter's dialog host at the outer note status bar.
 * Cells keep `vim({ status: false })` (no permanent cell chrome); sharing
 * `statusbar` makes `:`, `/`, and `?` mount via `updateStatus` on the note bar
 * instead of a nested `showVimPanel`.
 */
export function proxyCellExDialogToOuterStatus(
  cell: StatusHost,
  outer: StatusHost | null | undefined,
): () => void {
  const host = outer?.state.statusbar;
  if (!host) {
    return () => {};
  }
  const previous = cell.state.statusbar;
  cell.state.statusbar = host;
  return () => {
    if (cell.state.statusbar !== host) {
      return;
    }
    // If the cell tears down while a proxied dialog is still mounted (e.g. an
    // unexpected focus loss), clear the orphan and let the outer bar repaint.
    const dialog = cell.state.dialog;
    if (
      dialog &&
      typeof (host as Element).contains === "function" &&
      (host as Element).contains(dialog)
    ) {
      host.textContent = "";
      outer?.state.vimPlugin?.updateStatus?.();
    }
    if (previous === undefined) {
      delete cell.state.statusbar;
    } else {
      cell.state.statusbar = previous;
    }
  };
}

/**
 * Install the outer-status share on nested (status: false) cell editors, and
 * open or close the note's panel with the cell's prompt (status-panel.ts).
 */
export function shareOuterStatusForCellDialogs(outer: EditorView): Extension {
  return ViewPlugin.fromClass(
    class {
      private restore: () => void = () => {};
      private readonly sync = () => syncVimPanel(outer);
      private readonly cm: CodeMirror | null;
      constructor(view: EditorView) {
        this.cm = getCM(view);
        this.restore = proxyCellExDialogToOuterStatus(
          this.cm ?? { state: {} },
          getCM(outer),
        );
        // The cell's own "dialog" handler runs first and moves its prompt
        // into the shared panel.
        this.cm?.on("dialog", this.sync);
      }
      destroy() {
        this.cm?.off("dialog", this.sync);
        this.restore();
        this.sync();
      }
    },
  );
}
