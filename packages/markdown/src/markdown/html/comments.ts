import type { MarkdownIt, StateBlock } from "markdown-it";

/**
 * `%%comments%%` are hidden, as in Obsidian's reading view: inline within a
 * paragraph, and as a block when a line opens `%%` without closing it, over
 * blank lines and block syntax to the next `%%` (or the end of the note).
 * The block rule matches the editor's parser (`dialect/comments.ts`).
 */
export function comments(md: MarkdownIt): void {
  md.block.ruler.before("fence", "comment_block", commentBlock);
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
    return true;
  }
  let line = startLine + 1;
  while (line < endLine) {
    const text = state.src.slice(state.bMarks[line]!, state.eMarks[line]!);
    line++;
    if (text.includes("%%")) {
      break;
    }
  }
  state.line = line;
  const token = state.push("obsidian_comment_block", "", 0);
  token.map = [startLine, line];
  token.hidden = true;
  return true;
}
