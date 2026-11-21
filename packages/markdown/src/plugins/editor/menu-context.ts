import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { contributionId } from "../../shared/setting-schema";
import { ViewPlugin } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";

/**
 * VS Code builds a webview's context menu from the `data-vscode-context` of
 * the clicked element and its ancestors, read by a `contextmenu` listener on
 * the webview's window. The `lumiere.markdown.hasSelection` key that gates
 * the selection items travels from the webview through the extension host
 * to the workbench, so it lags the selection. On macOS a secondary click
 * (two-finger click or Ctrl-click) outside a selection first selects the
 * word under the pointer, as Chromium does there, and the menu opens before
 * the key can follow: the word looks selected but Copy Link for Agent is
 * missing. So the editor element carries the selection (and webviewSection) as
 * it is when the menu opens; that per-menu context shadows the global key.
 * It also says whether the selection starts on a heading line, where Rename
 * Heading… is offered, as Obsidian's editor menu offers Rename heading.
 */
const CONTEXT_ATTRIBUTE = "data-vscode-context";

/** The parts of the browser's selection the menu needs. */
export interface DomSelection {
  /** Both ends lie in the editor's content. */
  isInContent: boolean;
  isCollapsed: boolean;
  /** Where the selection starts in the document, when it is in the content. */
  from?: number;
}

/**
 * Whether the menu offers selection items.
 *
 * Prefer a non-collapsed browser selection in the content (macOS secondary
 * click selects the word before CodeMirror reads it). Otherwise trust
 * CodeMirror: Vim character-visual keeps a CM range while the DOM caret
 * stays collapsed, and that must still offer Copy Link for Agent (BH-048).
 */
export function menuHasSelection(
  dom: DomSelection | null,
  isStateEmpty: boolean,
): boolean {
  if (dom?.isInContent && !dom.isCollapsed) {
    return true;
  }
  return !isStateEmpty;
}

/** How long a menu may wait for the parse to reach the clicked line. */
const PARSE_BUDGET_MS = 200;

/**
 * Whether the line holding `position` is an ATX heading with a name: the
 * heading Rename Heading… renames from the caret. A `#` line in code or in
 * a list item is not one.
 */
export function isHeadingLine(state: EditorState, position: number): boolean {
  const line = state.doc.lineAt(position);
  const marker = /^ {0,3}#{1,6}[ \t]+\S/u.exec(line.text);
  if (!marker) {
    return false;
  }
  const start = line.from + marker[0].indexOf("#");
  // The parse may not have reached this line yet (a state just created, or
  // a long note parsed in slices): finish it up to the line, or a heading
  // reads as plain text and the menu leaves Rename Heading out.
  const tree =
    ensureSyntaxTree(state, line.to, PARSE_BUDGET_MS) ?? syntaxTree(state);
  for (
    let node: SyntaxNode | null = tree.resolveInner(start, 1);
    node;
    node = node.parent
  ) {
    if (/^ATXHeading[1-6]$/u.test(node.name)) {
      return true;
    }
  }
  return false;
}

/** The `data-vscode-context` value for a menu opened now. */
export function menuContext(
  hasSelection: boolean,
  isOnHeading = false,
): string {
  // webviewSection must travel with hasSelection: the stamp replaces the
  // editor element's attribute, and clicks on scroller chrome / widgets may
  // not sit under contentDOM (where contentAttributes puts webviewSection).
  return JSON.stringify({
    webviewSection: "markdownContent",
    [contributionId("hasSelection")]: hasSelection,
    [contributionId("selectionOnHeading")]: isOnHeading,
  });
}

function readDomSelection(view: EditorView): DomSelection | null {
  const selection = view.contentDOM.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const isInContent =
    view.contentDOM.contains(selection.anchorNode) &&
    view.contentDOM.contains(selection.focusNode);
  const from = isInContent ? domSelectionFrom(view, selection) : undefined;
  return {
    isInContent,
    isCollapsed: selection.isCollapsed,
    ...(from !== undefined && { from }),
  };
}

/**
 * The browser's selection start, which a secondary click has already moved
 * (to the word on macOS, to the pointer elsewhere) before CodeMirror reads
 * it. Rename Heading… reads the caret later, once CodeMirror has.
 */
function domSelectionFrom(
  view: EditorView,
  selection: Selection,
): number | undefined {
  try {
    return Math.min(
      view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
      view.posAtDOM(selection.focusNode!, selection.focusOffset),
    );
  } catch {
    // posAtDOM throws for a node outside the document's content.
    return undefined;
  }
}

/**
 * The attribute goes on the editor element, not the content: CodeMirror
 * observes the content's attributes and restores its own. The listener is a
 * plain one on the editor element because CodeMirror's handlers skip events
 * inside widgets, and a rendered link or image can sit in the selection; it
 * runs before VS Code's window listener as the event bubbles.
 */
export const menuSelectionContext = ViewPlugin.define((view) => {
  const stampSelection = () => {
    const dom = readDomSelection(view);
    const hasSelection = menuHasSelection(dom, view.state.selection.main.empty);
    const from = dom?.from ?? view.state.selection.main.from;
    view.dom.setAttribute(
      CONTEXT_ATTRIBUTE,
      menuContext(hasSelection, isHeadingLine(view.state, from)),
    );
  };
  // Capture: stamp before VS Code's window listener reads data-vscode-context.
  view.dom.addEventListener("contextmenu", stampSelection, true);
  return {
    destroy() {
      view.dom.removeEventListener("contextmenu", stampSelection, true);
      view.dom.removeAttribute(CONTEXT_ATTRIBUTE);
    },
  };
});
