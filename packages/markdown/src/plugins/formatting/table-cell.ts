import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "../../markdown/dialect";

/**
 * Whether `pos` lies within a parsed Markdown table. Obsidian's
 * `inTableCell` check leaves list, quote, callout and code-block commands
 * unavailable while a projected cell editor is active. Lumiere keeps one
 * document, so any position in a `Table` node (a cell, its pipes or its
 * separator row) approximates that check for the formatting commands.
 */
export function isInTableCell(
  state: EditorState,
  pos: number = state.selection.main.head,
): boolean {
  const tree = markdownParser.parse(state.doc.toString());
  let node: SyntaxNode | null = tree.resolveInner(pos, 1);
  while (node) {
    if (node.name === "Table") {
      return true;
    }
    node = node.parent;
  }
  return false;
}
