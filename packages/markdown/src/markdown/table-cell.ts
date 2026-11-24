import type { EditorState, SelectionRange } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { markdownParser } from "./dialect";

/**
 * Whether `pos` lies within a parsed Markdown table. Obsidian's
 * `inTableCell` check leaves list, quote, callout, checklist and code-block
 * commands unavailable while a projected cell editor is active. Lumiere keeps
 * one document, so any position in a `Table` node (a cell, its pipes or its
 * separator row) approximates that check for those commands.
 */
export function isInTableCell(
  state: EditorState,
  pos: number = state.selection.main.head,
): boolean {
  return isInTable(markdownParser.parse(state.doc.toString()), pos);
}

/**
 * Whether a block command must refuse a selection: for each range, its head
 * is in a table, or its lower end is, so a selection that runs out of a table
 * either way cannot edit a row. Pass the ranges a command edits; by default,
 * every range of the selection.
 */
export function selectionTouchesTableCell(
  state: EditorState,
  ranges: readonly SelectionRange[] = state.selection.ranges,
): boolean {
  const tree = markdownParser.parse(state.doc.toString());
  return ranges.some(
    (range) =>
      isInTable(tree, range.head) ||
      (range.from !== range.head && isInTable(tree, range.from)),
  );
}

/**
 * Whether a command that rewrites every selected line must refuse: a table
 * lies on a line that one of the ranges covers, from its first line to its
 * last. A line that holds an end in a table is such a line, so this includes
 * everything `selectionTouchesTableCell` refuses.
 */
export function selectionCoversTable(state: EditorState): boolean {
  const tree = markdownParser.parse(state.doc.toString());
  return state.selection.ranges.some((range) => {
    let found = false;
    tree.iterate({
      from: state.doc.lineAt(range.from).from,
      to: state.doc.lineAt(range.to).to,
      enter: (node) => {
        found ||= node.name === "Table";
        return !found;
      },
    });
    return found;
  });
}

// A table's last row ends where its node ends, so a position there is found
// from the table's side, not the text after it.
function isInTable(tree: Tree, pos: number): boolean {
  return (
    hasTableAncestor(tree.resolveInner(pos, 1)) ||
    hasTableAncestor(tree.resolveInner(pos, -1))
  );
}

function hasTableAncestor(start: SyntaxNode): boolean {
  let node: SyntaxNode | null = start;
  while (node) {
    if (node.name === "Table") {
      return true;
    }
    node = node.parent;
  }
  return false;
}
