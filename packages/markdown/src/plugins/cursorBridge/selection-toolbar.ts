import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditorView as View } from "@codemirror/view";
import { t } from "@workshop/l10n";

/** Whether the Cursor selection chrome should be visible. */
export function shouldShowSelectionToolbar(input: {
  inCursor: boolean;
  from: number;
  to: number;
  hasFocus: boolean;
}): boolean {
  return input.inCursor && input.hasFocus && input.from !== input.to;
}

export interface SelectionToolbarAction {
  readonly id: "chat" | "edit";
  readonly label: string;
  readonly shortcut: string;
}

/** Cursor floating-toolbar actions for a Live Preview selection. */
export function selectionToolbarActions(
  isMac: boolean,
): readonly SelectionToolbarAction[] {
  const mod = isMac ? "⌘" : "Ctrl";
  return [
    { id: "chat", label: t("Add to Chat"), shortcut: `${mod}+L` },
    { id: "edit", label: t("Quick Edit"), shortcut: `${mod}+K` },
  ];
}

function toolbarButton(
  action: SelectionToolbarAction,
  handOff: (mode: "chat" | "edit") => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-cursor-selection-toolbar-button";
  button.dataset.mode = action.id;
  button.setAttribute("aria-label", `${action.label} ${action.shortcut}`);
  const label = document.createElement("span");
  label.textContent = action.label;
  const shortcut = document.createElement("kbd");
  shortcut.textContent = action.shortcut;
  button.append(label, shortcut);
  button.addEventListener("mousedown", (event) => {
    // Keep the selection; avoid editor blur before handoff.
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handOff(action.id);
  });
  return button;
}

function positionToolbar(view: View, dom: HTMLElement): void {
  const selection = view.state.selection.main;
  const show = shouldShowSelectionToolbar({
    inCursor: true,
    from: selection.from,
    to: selection.to,
    hasFocus: view.hasFocus,
  });
  if (!show) {
    dom.style.display = "none";
    return;
  }
  const coords =
    view.coordsAtPos(selection.head) ?? view.coordsAtPos(selection.from);
  if (!coords) {
    dom.style.display = "none";
    return;
  }
  const owner = view.dom.getBoundingClientRect();
  dom.style.display = "flex";
  dom.style.left = `${Math.max(0, coords.left - owner.left)}px`;
  dom.style.top = `${Math.max(0, coords.top - owner.top - 36)}px`;
}

/**
 * Floating Add to Chat / Quick Edit bar near the Live Preview selection,
 * matching Cursor's native selection chrome.
 */
export function selectionToolbarExtension(
  handOff: (mode: "chat" | "edit") => void,
  isMac = /Mac|iPhone|iPad/u.test(globalThis.navigator?.userAgent ?? ""),
) {
  return [
    selectionToolbarTheme,
    ViewPlugin.fromClass(
      class {
        readonly dom: HTMLElement;

        constructor(readonly view: View) {
          this.dom = document.createElement("div");
          this.dom.className = "cm-cursor-selection-toolbar";
          this.dom.setAttribute("role", "toolbar");
          this.dom.setAttribute("aria-label", t("Cursor selection actions"));
          this.dom.style.display = "none";
          for (const action of selectionToolbarActions(isMac)) {
            this.dom.append(toolbarButton(action, handOff));
          }
          view.dom.append(this.dom);
          this.update(undefined);
        }

        update(_update: ViewUpdate | undefined): void {
          positionToolbar(this.view, this.dom);
        }

        destroy(): void {
          this.dom.remove();
        }
      },
    ),
  ];
}

const selectionToolbarTheme = EditorView.baseTheme({
  ".cm-cursor-selection-toolbar": {
    position: "absolute",
    zIndex: "20",
    display: "flex",
    gap: "4px",
    padding: "4px",
    borderRadius: "6px",
    backgroundColor: "var(--vscode-editorWidget-background, #252526)",
    color: "var(--vscode-editorWidget-foreground, #cccccc)",
    border: "1px solid var(--vscode-editorWidget-border, #454545)",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.36)",
    pointerEvents: "auto",
  },
  ".cm-cursor-selection-toolbar-button": {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    margin: "0",
    padding: "4px 8px",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: "12px",
    cursor: "pointer",
  },
  ".cm-cursor-selection-toolbar-button:hover": {
    backgroundColor: "var(--vscode-list-hoverBackground, #2a2d2e)",
  },
  ".cm-cursor-selection-toolbar-button kbd": {
    opacity: "0.7",
    fontSize: "11px",
  },
});
