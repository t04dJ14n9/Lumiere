import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

/**
 * A `%%` that opens a line without closing on it starts a block comment, as
 * in Obsidian: it runs over blank lines and block syntax to the next `%%`
 * (the rest of that line included), or to the end of the note when nothing
 * closes it. Headings, lists and tables inside are not parsed, so they are
 * not the note's headings or sections. A comment that closes on its own
 * line stays an inline comment of its paragraph.
 */
function parseCommentBlock(cx: BlockContext, line: Line): boolean {
  if (line.indent >= 4 || !line.text.startsWith("%%", line.pos)) {
    return false;
  }
  if (line.text.indexOf("%%", line.pos + 2) >= 0) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  while (cx.nextLine()) {
    const end = line.text.indexOf("%%");
    if (end >= 0) {
      const to = cx.lineStart + end + 2;
      cx.nextLine();
      cx.addElement(cx.elt("ObsidianComment", from, to));
      return true;
    }
  }
  cx.addElement(cx.elt("ObsidianComment", from, cx.prevLineEnd()));
  return true;
}

export const comments: MarkdownConfig = {
  defineNodes: ["ObsidianComment"],
  parseBlock: [
    {
      name: "ObsidianCommentBlock",
      before: "FencedCode",
      parse: parseCommentBlock,
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
