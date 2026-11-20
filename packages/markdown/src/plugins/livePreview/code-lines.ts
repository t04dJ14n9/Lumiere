import type { SyntaxNodeRef } from "@lezer/common";
import type { InlineContext } from "./api";

/**
 * Code blocks stay editable source lines in Live Preview, as in Obsidian, so
 * moving the caret in or out never changes the layout: every line keeps its
 * class (and so its height) either way. Outside the block only the fence text
 * is hidden; the fence lines stay, empty, as the block's top and bottom
 * padding (the codeBlocks plugin puts the language label in the opening one).
 */
export function decorateCodeLines(
  node: SyntaxNodeRef,
  context: Pick<InlineContext, "state" | "line" | "hide" | "revealed">,
  visible?: { from: number; to: number },
): void {
  const { state } = context;
  if (node.name === "CodeBlock") {
    // An indented block's node starts after the first line's indentation.
    const start = visible ? Math.max(node.from, visible.from) : node.from;
    const end = visible ? Math.min(node.to, visible.to) : node.to;
    if (start > end) {
      return;
    }
    for (
      let line = state.doc.lineAt(start);
      ;
      line = state.doc.line(line.number + 1)
    ) {
      context.line(line.from, "md-code-line md-code-indented");
      if (line.to >= end || line.number === state.doc.lines) {
        break;
      }
    }
    return;
  }
  if (node.name !== "FencedCode") {
    return;
  }
  const open = state.doc.lineAt(node.from);
  const close = state.doc.lineAt(node.to);
  const marks = node.node.getChildren("CodeMark");
  const closer = marks.length > 1 ? marks[marks.length - 1] : undefined;
  const closed = close.number > open.number && closer !== undefined;
  context.line(open.from, "md-code-fence md-code-fence-open");
  if (closed) {
    context.line(close.from, "md-code-fence md-code-fence-close");
  }
  if (context.revealed(open.from, close.to)) {
    return;
  }
  // From the fence marks, not the line start: a fence opened on a list
  // item's first line (`- ```js`) keeps its bullet, and the quote and list
  // marks before them have decorations of their own.
  context.hide(node.from, open.to);
  if (closed) {
    context.hide(closer.from, close.to);
  }
}
