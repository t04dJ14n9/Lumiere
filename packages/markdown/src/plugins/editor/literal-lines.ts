import type { EditorState, Line } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

// Waiting longer than this for the parser on a key press is worse than
// treating the line as Markdown, which is what the key did before.
const PARSE_BUDGET_MS = 20;

/**
 * Whether the caret's line is literal text: a line of an indented code block,
 * or a line between the fences of fenced code or frontmatter. Markdown's
 * list, quote, heading and rule syntax means nothing there, so Tab,
 * Shift+Tab and Backspace must not treat `# comment` or `---` in a Python
 * fence as Markdown. The fence lines themselves are not literal: indenting
 * them would break the block.
 */
export function caretOnLiteralLine(state: EditorState): boolean {
  const line = state.doc.lineAt(state.selection.main.head);
  const tree =
    ensureSyntaxTree(state, line.to, PARSE_BUDGET_MS) ?? syntaxTree(state);
  for (
    let node: SyntaxNode | null = tree.resolveInner(textStartOf(line), 1);
    node;
    node = node.parent
  ) {
    if (node.name === "CodeBlock") {
      return true;
    }
    if (node.name === "FencedCode" || node.name === "Frontmatter") {
      return betweenFences(state, node, line);
    }
  }
  return false;
}

/** Where the line's text starts: indented code starts after its indent. */
function textStartOf(line: Line): number {
  return line.from + line.text.length - line.text.trimStart().length;
}

function betweenFences(
  state: EditorState,
  node: SyntaxNode,
  line: Line,
): boolean {
  const first = state.doc.lineAt(node.from).number;
  const last = state.doc.lineAt(node.to).number;
  if (line.number <= first) {
    return false;
  }
  // An unclosed block runs to the end of the note; its last line is text.
  return line.number < last || !isClosed(state, node, first, last);
}

function isClosed(
  state: EditorState,
  node: SyntaxNode,
  first: number,
  last: number,
): boolean {
  if (last === first) {
    return false;
  }
  if (node.name === "FencedCode") {
    const closer = node.lastChild;
    return (
      closer?.name === "CodeMark" &&
      closer.from >= state.doc.line(last).from &&
      closer.from > node.from
    );
  }
  return /^(---|\.\.\.)\s*$/u.test(state.doc.line(last).text);
}
