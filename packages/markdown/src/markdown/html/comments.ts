import type { MarkdownIt, StateBlock } from "markdown-it";
import { hasOpenComment } from "../comment-markers";
import { markdownParser } from "../dialect";

/**
 * `%%comments%%` are hidden, as in Obsidian's reading view: inline within a
 * paragraph, and as a block when a line opens `%%` without closing it, over
 * blank lines and block syntax to the next `%%` (or the end of its
 * container). The block rule matches the editor's parser
 * (`dialect/comments.ts`): a `%%` line ends a paragraph unless the
 * paragraph's own `%%` is still open, and text after the closing `%%` is
 * parsed as a new block.
 */
export function comments(md: MarkdownIt): void {
  md.block.ruler.before("fence", "comment_block", commentBlock, {
    alt: ["paragraph"],
  });
  md.inline.ruler.before("escape", "comment", (state, silent) => {
    if (!state.src.startsWith("%%", state.pos)) {
      return false;
    }
    const end = state.src.indexOf("%%", state.pos + 2);
    if (end < 0) {
      return false;
    }
    if (!silent) {
      state.push("obsidian_comment", "", 0);
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.obsidian_comment = () => "";
  md.renderer.rules.obsidian_comment_block = () => "";
}

function commentBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const lineEnd = state.eMarks[startLine]!;
  if (
    state.sCount[startLine]! - state.blkIndent >= 4 ||
    !state.src.startsWith("%%", start) ||
    state.src.slice(start + 2, lineEnd).includes("%%")
  ) {
    return false;
  }
  if (silent) {
    // Only the paragraph rule asks (`alt`), with `state.line` at the
    // paragraph's first line.
    const paragraph = state.src.slice(
      state.bMarks[state.line],
      state.eMarks[startLine - 1],
    );
    return !hasOpenComment(paragraph, markdownParser);
  }
  const close = closingLine(state, startLine + 1, endLine);
  const token = state.push("obsidian_comment_block", "", 0);
  token.hidden = true;
  if (close.at === undefined) {
    state.line = close.line;
    token.map = [startLine, close.line];
    return true;
  }
  token.map = [startLine, close.line + 1];
  const rest = close.at + 2;
  if (state.src.slice(rest, state.eMarks[close.line]).trim() === "") {
    state.line = close.line + 1;
    return true;
  }
  continueLineAt(state, close.line, rest);
  return true;
}

/**
 * The line holding the comment's closing `%%` and its offset, or, with no
 * `at`, the line after the comment's container: a line indented less than
 * the list item it is in ends it, as a quote's last line does.
 */
function closingLine(
  state: StateBlock,
  from: number,
  endLine: number,
): { line: number; at?: number } {
  for (let line = from; line < endLine; line++) {
    if (!state.isEmpty(line) && state.sCount[line]! < state.blkIndent) {
      return { line };
    }
    const lineStart = state.bMarks[line]! + state.tShift[line]!;
    const at = state.src.indexOf("%%", lineStart);
    if (at >= 0 && at < state.eMarks[line]!) {
      return { line, at };
    }
  }
  return { line: endLine };
}

/**
 * Starts `line` again at `offset`, so the block rules parse what follows the
 * comment as a line of its own, as the editor's parser does.
 */
function continueLineAt(state: StateBlock, line: number, offset: number): void {
  const spaces = /^[ \t]*/.exec(state.src.slice(offset, state.eMarks[line]))![0]
    .length;
  state.bMarks[line] = offset;
  state.tShift[line] = spaces;
  state.sCount[line] = state.blkIndent + spaces;
  state.line = line;
}
