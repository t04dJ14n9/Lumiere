import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";

/** The parts of @replit/codemirror-vim's state the status line reads. */
export interface VimStatusState {
  mode?: string;
  insertModeReturn?: unknown;
  status?: string;
}

/** Added to the note editor while the host's status bar shows the mode. */
export const HOST_STATUS_CLASS = "lumiere-vim-host-status";

/**
 * The text Vim's own panel shows: the mode (`-- NORMAL --`, `-- VISUAL LINE
 * --`, `-- INSERT (C-O) --`) and the keys typed so far (`d2`).
 */
export function vimStatusText(vim: VimStatusState | undefined): string {
  let mode = (vim?.mode || "normal").toUpperCase();
  if (vim?.insertModeReturn) {
    mode += " (C-O)";
  }
  const pending = vim?.status ?? "";
  return pending ? `-- ${mode} --  ${pending}` : `-- ${mode} --`;
}

type StatusPlugin = { updateStatus?: () => void };

/**
 * Report the status of the focused editor (the note or a table cell) each
 * time Vim refreshes its panel, and when the editor gains focus.
 */
export function vimStatusReporter(
  report: (view: EditorView, text: string) => void,
): Extension {
  const send = (view: EditorView) => {
    const cm = getCM(view);
    if (cm) {
      report(view, vimStatusText(cm.state.vim as VimStatusState | undefined));
    }
  };
  return [
    ViewPlugin.fromClass(
      class {
        private restore: () => void = () => {};
        constructor(view: EditorView) {
          const plugin = getCM(view)?.state.vimPlugin as
            StatusPlugin | undefined;
          const update = plugin?.updateStatus;
          if (!plugin || !update) {
            return;
          }
          // Vim calls this after every key, mode change, command and prompt.
          plugin.updateStatus = () => {
            update.call(plugin);
            if (view.hasFocus) {
              send(view);
            }
          };
          this.restore = () => {
            plugin.updateStatus = update;
          };
        }
        destroy() {
          this.restore();
        }
      },
    ),
    EditorView.domEventHandlers({
      focus(_event, view) {
        send(view);
        return false;
      },
    }),
  ];
}
