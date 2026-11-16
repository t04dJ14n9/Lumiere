import type {
  BlockContext,
  LeafBlock,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";
import { hasOpenComment } from "../comment-markers";

/**
 * Whether `line` opens a block comment: `%%` first on the line (indented less
 * than code, counted from its container) and not closed on it.
 */
function opensCommentBlock(line: Line): boolean {
  return (
    line.indent - line.baseIndent < 4 &&
    line.text.startsWith("%%", line.pos) &&
    line.text.indexOf("%%", line.pos + 2) < 0
  );
}

/**
 * A `%%` that opens a line without closing on it starts a block comment, as
 * in Obsidian: it runs over blank lines and block syntax to the next `%%`,
 * or, when nothing closes it, to the end of its container (the note, or the
 * quote or list item it is in). Headings, lists and tables inside are not
 * parsed, so they are not the note's headings or sections. Text after the
 * closing `%%` on its line is parsed as the start of a new block, as if the
 * comment were not there. A comment that closes on its own line stays an
 * inline comment of its paragraph.
 */
function parseCommentBlock(cx: BlockContext, line: Line): boolean | null {
  if (!opensCommentBlock(line)) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  // As FencedCode: a line that does not continue the comment's container
  // (the quote or list item ended) ends an unclosed comment.
  while (cx.nextLine() && continuedDepth(line) >= cx.depth) {
    const end = line.text.indexOf("%%", line.pos);
    if (end < 0) {
      continue;
    }
    cx.addElement(cx.elt("ObsidianComment", from, cx.lineStart + end + 2));
    if (line.text.slice(end + 2).trim() === "") {
      cx.nextLine();
      return true;
    }
    // Null leaves the rest of the line to the other block parsers, as a
    // quote's `>` does; they start a paragraph there.
    line.moveBase(end + 2);
    return null;
  }
  cx.addElement(cx.elt("ObsidianComment", from, cx.prevLineEnd()));
  return true;
}

/**
 * How many of the open containers `line` continues. `@lezer/markdown` keeps
 * this field out of its types; its own FencedCode reads it the same way.
 */
function continuedDepth(line: Line): number {
  return (line as Line & { depth: number }).depth;
}

/**
 * A `%%` line ends a paragraph, as a `$$` line does, unless the paragraph
 * has a `%%` of its own still open: then the line closes that comment.
 */
function endsParagraph(
  _cx: BlockContext,
  line: Line,
  leaf: LeafBlock,
): boolean {
  return opensCommentBlock(line) && !hasOpenComment(leaf.content);
}

export const comments: MarkdownConfig = {
  defineNodes: ["ObsidianComment"],
  parseBlock: [
    {
      name: "ObsidianCommentBlock",
      before: "FencedCode",
      parse: parseCommentBlock,
      endLeaf: endsParagraph,
    },
  ],
  parseInline: [
    {
      name: "ObsidianComment",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== 37 || cx.char(pos + 1) !== 37) {
          return -1;
        }
        const end = cx.text.indexOf("%%", pos + 2 - cx.offset);
        return end < 0
          ? -1
          : cx.addElement(cx.elt("ObsidianComment", pos, end + cx.offset + 2));
      },
    },
  ],
};
