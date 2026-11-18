import { StateEffect, StateField, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { ViewPlugin, showPanel, type Panel } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";

/**
 * The note's Vim panel: the mode line, or a `:` / `/` / `?` prompt or a Vim
 * message (the note's own or a table cell's, see cell-ex-status.ts).
 *
 * It replaces codemirror-vim's `status: true` panel, which is always mounted.
 * When the host's status bar shows the mode, the panel must close in between
 * prompts, and it has to leave CodeMirror's panels to do so: CodeMirror
 * measures a mounted bottom panel's rect for its scroll margins, and a panel
 * hidden with CSS measures as covering the whole editor. Drag-select then
 * autoscrolled on every mouse move and `gg` / `G` scrolled the caret out of
 * view.
 */

/** What decides whether the panel is mounted. */
export interface VimPanelState {
  /** The host's status bar shows the mode, so the mode line is not needed. */
  hostShowsMode: boolean;
  /** A prompt or a message is in the panel. */
  hasPrompt: boolean;
}

export function isVimPanelOpen(state: VimPanelState): boolean {
  return !state.hostShowsMode || state.hasPrompt;
}

/** Prompts and messages mount as a <div>; the mode line is made of <span>s. */
export function hasPrompt(panel: Pick<Element, "children">): boolean {
  return Array.from(panel.children).some((child) => child.tagName === "DIV");
}

/** Dispatched once the host says its status bar shows the mode. */
export const setHostShowsMode = StateEffect.define<boolean>();
const setHasPrompt = StateEffect.define<boolean>();

/**
 * The panel's element outlives its mounts: codemirror-vim writes into it as
 * `statusbar`, and table cells capture it when they are created.
 */
const panelElements = new WeakMap<EditorView, HTMLElement>();

function panelElement(view: EditorView): HTMLElement {
  let element = panelElements.get(view);
  if (!element) {
    element = view.dom.ownerDocument.createElement("div");
    element.className = "cm-vim-panel";
    panelElements.set(view, element);
  }
  return element;
}

const mountPanel = (view: EditorView): Panel => ({
  dom: panelElement(view),
  top: false,
});

const panelState = StateField.define<VimPanelState>({
  create: () => ({ hostShowsMode: false, hasPrompt: false }),
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setHostShowsMode)) {
        next = { ...next, hostShowsMode: effect.value };
      } else if (effect.is(setHasPrompt)) {
        next = { ...next, hasPrompt: effect.value };
      }
    }
    return next;
  },
  provide: (field) =>
    showPanel.from(field, (state) =>
      isVimPanelOpen(state) ? mountPanel : null,
    ),
});

/**
 * Mount or unmount the panel after a prompt or message opened or closed in
 * it. Opening is synchronous: Vim focuses the prompt's input right after
 * signalling it, and an input outside the document cannot take focus.
 * Closing waits a microtask, because a table cell may close its prompt while
 * it is being destroyed inside the note's own update.
 */
export function syncVimPanel(view: EditorView): void {
  const element = panelElements.get(view);
  const state = view.state.field(panelState, false);
  if (!element || !state || state.hasPrompt === hasPrompt(element)) {
    return;
  }
  if (hasPrompt(element)) {
    view.dispatch({ effects: setHasPrompt.of(true) });
    return;
  }
  queueMicrotask(() => {
    if (!hasPrompt(element) && view.state.field(panelState).hasPrompt) {
      view.dispatch({ effects: setHasPrompt.of(false) });
    }
  });
}

type StatusAdapter = {
  state: {
    statusbar?: Element | null;
    vimPlugin?: { updateStatus?: () => void };
  };
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
};

/** Hand the panel's element to codemirror-vim as its status bar. */
const statusOwner = ViewPlugin.fromClass(
  class {
    private readonly cm: StatusAdapter | null;
    private readonly sync: () => void;
    constructor(view: EditorView) {
      this.cm = getCM(view) as StatusAdapter | null;
      this.sync = () => syncVimPanel(view);
      if (!this.cm) {
        return;
      }
      this.cm.state.statusbar = panelElement(view);
      this.cm.state.vimPlugin?.updateStatus?.();
      // Vim's own "dialog" handler runs first and moves the prompt into the
      // status bar, so this one sees where it ended up.
      this.cm.on("dialog", this.sync);
    }
    destroy() {
      this.cm?.off("dialog", this.sync);
    }
  },
);

/**
 * The note editor's Vim panel. Use with `vim({ status: false })`: with
 * `statusbar` set, codemirror-vim renders the mode line and prompts into it
 * and never opens its own prompt-only panel.
 */
export function vimStatusPanel(): Extension {
  return [panelState, statusOwner];
}
