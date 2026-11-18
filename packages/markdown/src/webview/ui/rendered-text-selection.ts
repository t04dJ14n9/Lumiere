import { EditorState, Transaction } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, PluginValue, ViewUpdate } from "@codemirror/view";
import { isBlockControl } from "./block-pointer";

/**
 * The rendered blocks whose text a drag selects as text, as in Obsidian's
 * reading view: a callout's or an HTML block's prose. Code, math and
 * diagrams keep their own pointer handling.
 */
const PROSE_BLOCKS = ".hybrid-callout, .hybrid-HTMLBlock";

/** A text selection made in a rendered block, as the DOM held it. */
interface KeptSelection {
  readonly shell: HTMLElement;
  readonly anchorNode: Node;
  readonly anchorOffset: number;
  readonly focusNode: Node;
  readonly focusOffset: number;
}

/** The DOM selection, when both its ends are inside `shell`. */
function rangeIn(
  shell: HTMLElement,
  selection: Selection,
): KeptSelection | undefined {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (
    !anchorNode ||
    !focusNode ||
    !shell.contains(anchorNode) ||
    !shell.contains(focusNode)
  ) {
    return undefined;
  }
  return { shell, anchorNode, anchorOffset, focusNode, focusOffset };
}

/**
 * The rendered block whose prose is under the pointer, or null: inside a
 * callout's or HTML block's rendered Markdown, and not on a control (a link,
 * a fold title, a checkbox, the Edit button).
 */
export function renderedProseShell(
  target: EventTarget | null,
): HTMLElement | null {
  const element = target instanceof Node ? elementOf(target) : null;
  const shell = element?.closest(PROSE_BLOCKS);
  if (
    !element ||
    !(shell instanceof HTMLElement) ||
    !element.closest(".markdown-rendered") ||
    isBlockControl(shell, element)
  ) {
    return null;
  }
  return shell;
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/**
 * Whether a key leaves a rendered-text selection as it is: a modifier on its
 * own, or Copy (Cmd/Ctrl+C), whose `copy` event this plugin answers.
 */
export function keyKeepsRenderedSelection(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) {
    return true;
  }
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "c"
  );
}

/**
 * Select text inside a rendered callout or HTML block by dragging, and copy
 * it, as in Obsidian's reading view. CodeMirror leaves presses on a widget
 * alone, so the browser selects the text; but CodeMirror writes its own
 * selection back into the DOM on every update while the editor has focus
 * (the focus change after the press, the pointer freeze, a status update),
 * and that wiped the reader's selection, or, mid-drag, collapsed it into a
 * caret at the block's start that revealed its source. So the selection is
 * kept and put back after an update that moved neither the text nor the
 * editor's own selection, and `renderedSelectionFilter` drops the caret
 * CodeMirror reads from it. Public API only: no CodeMirror internals. A press elsewhere, an edit, a new editor
 * selection or a key other than Copy lets it go. Copy and Cut take the
 * rendered text; CodeMirror would copy its own selection, or the caret's
 * line.
 *
 * A plain click still reveals the source (click-to-edit), and a press on
 * this prose does not start the pointer freeze (`pointer-selection.ts`).
 */
export const renderedTextSelection = ViewPlugin.fromClass(
  class implements PluginValue {
    private kept: KeptSelection | undefined;
    private pressing: HTMLElement | undefined;
    private readonly events = new AbortController();

    constructor(private readonly view: EditorView) {
      const doc = view.dom.ownerDocument;
      const options = { capture: true, signal: this.events.signal };
      view.dom.addEventListener("mousedown", (e) => this.press(e), options);
      doc.addEventListener("mouseup", () => this.release(), options);
      doc.addEventListener("selectionchange", () => this.track(), {
        signal: this.events.signal,
      });
      view.dom.addEventListener("keydown", (e) => this.key(e), options);
      doc.addEventListener("copy", (e) => this.copy(e), options);
      doc.addEventListener("cut", (e) => this.copy(e), options);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet) {
        this.kept = undefined;
      }
      const shell = this.pressing ?? this.kept?.shell;
      const selection = this.view.dom.ownerDocument.getSelection();
      if (!shell?.isConnected || !selection) {
        this.kept = undefined;
        return;
      }
      // Read before CodeMirror writes its own selection (after the plugins
      // update), even mid-drag, before the browser's selectionchange.
      const live = rangeIn(shell, selection);
      if (live && !selection.isCollapsed) {
        this.kept = live;
      }
      const target = live ?? this.kept;
      if (target) {
        // Put the reader's back once CodeMirror has written, before paint.
        queueMicrotask(() => this.restore(target));
      }
    }

    destroy(): void {
      this.events.abort();
    }

    private press(event: MouseEvent): void {
      this.kept = undefined;
      this.pressing =
        event.button === 0 && !event.shiftKey
          ? (renderedProseShell(event.target) ?? undefined)
          : undefined;
    }

    private release(): void {
      this.pressing = undefined;
    }

    /** Remember a selection the reader makes inside the pressed block. */
    private track(): void {
      const shell = this.pressing ?? this.kept?.shell;
      const selection = this.view.dom.ownerDocument.getSelection();
      const range = shell && selection ? rangeIn(shell, selection) : undefined;
      if (range && !selection!.isCollapsed) {
        this.kept = range;
      }
    }

    private restore(kept: KeptSelection): void {
      const selection = this.view.dom.ownerDocument.getSelection();
      const current = this.kept === kept || this.pressing === kept.shell;
      if (!current || !selection || !kept.shell.isConnected) {
        return;
      }
      if (
        selection.anchorNode === kept.anchorNode &&
        selection.anchorOffset === kept.anchorOffset &&
        selection.focusNode === kept.focusNode &&
        selection.focusOffset === kept.focusOffset
      ) {
        return;
      }
      selection.setBaseAndExtent(
        kept.anchorNode,
        kept.anchorOffset,
        kept.focusNode,
        kept.focusOffset,
      );
    }

    /** Any other key acts on the editor's selection: show it again first. */
    private key(event: KeyboardEvent): void {
      if (!this.kept || keyKeepsRenderedSelection(event)) {
        return;
      }
      this.kept = undefined;
      this.view.dispatch({ selection: this.view.state.selection });
    }

    /** Copy (and Cut, which cannot remove rendered text) take the rendered text. */
    private copy(event: ClipboardEvent): void {
      const selection = this.view.dom.ownerDocument.getSelection();
      const kept = this.kept;
      if (
        !kept ||
        !selection ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !kept.shell.contains(selection.anchorNode)
      ) {
        return;
      }
      // Before CodeMirror's handler on its content, which copies its own
      // selection; the browser's own copy takes the DOM selection.
      event.stopPropagation();
      if (event.type === "cut") {
        event.preventDefault();
        event.clipboardData?.setData("text/plain", selection.toString());
      }
    }
  },
);

/**
 * CodeMirror reads the DOM selection when it flushes and maps one inside a
 * widget to a caret at the widget's start, which reveals a callout's source
 * under the reader's drag. Such a selection-only change, read from the DOM
 * (`select`) while the DOM selection is in a callout's rendered prose, is
 * dropped; the reader's selection is not the editor's.
 */
export const renderedSelectionFilter = EditorState.transactionFilter.of(
  (tr) => {
    if (
      tr.docChanged ||
      !tr.selection ||
      tr.annotation(Transaction.userEvent) !== "select" ||
      typeof document === "undefined"
    ) {
      return tr;
    }
    const anchor = document.getSelection()?.anchorNode ?? null;
    return renderedProseShell(anchor) ? [] : tr;
  },
);
