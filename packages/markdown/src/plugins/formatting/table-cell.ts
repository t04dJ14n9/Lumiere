import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "../../markdown/dialect";

/**
 * Whether `pos` lies within a Markdown table row. Obsidian disables list,
 * quote, callout and code-block commands while the caret is in a table cell,
 * because those block edits would break the row's `|` layout. Lumia keeps one
 * document, so any position in the parsed `Table` node (a cell, its pipes or
 * its separator row) stands in for Obsidian's nested cell editor.
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
