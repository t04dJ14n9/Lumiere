import type { MarkdownConfig } from "@lezer/markdown";

/**
 * Whether a line (from its first non-space character) opens display math.
 * A formula closed on the same line is a block only when nothing but
 * whitespace follows it; `$$E=mc^2$$ is famous` is a paragraph whose `$$…$$`
 * is inline display math, so the sentence after it is kept.
 */
export function opensMathBlock(text: string): boolean {
  if (!text.startsWith("$$")) {
    return false;
  }
  const closing = text.indexOf("$$", 2);
  return closing < 0 || text.slice(closing + 2).trim() === "";
}

const DOLLAR = 36;
const BACKSLASH = 92;
const NEWLINE = 10;
const isSpace = (char: number) => /\s/.test(String.fromCharCode(char));

/**
 * Where the inline formula opened by the `$` or `$$` at `pos` closes (the
 * offset of its closing delimiter), or -1 when it does not, reading
 * characters through `char` up to `end`. The editor's parser and the HTML
 * renderer both use it, so Live Preview and rendered blocks agree on which
 * text is math: `$` must not be followed by a space, a closing `$` must not
 * follow a space or a backslash (a later one may close instead), and a
 * formula does not run over a line break.
 */
export function inlineMathEnd(
  char: (at: number) => number,
  pos: number,
  end: number,
): number {
  const width = char(pos + 1) === DOLLAR ? 2 : 1;
  if (width === 1 && isSpace(char(pos + 1))) {
    return -1;
  }
  for (let at = pos + width + 1; at < end; at++) {
    const current = char(at);
    if (current === NEWLINE) {
      return -1;
    }
    if (
      current === DOLLAR &&
      char(at - 1) !== BACKSLASH &&
      (width === 1 || char(at + 1) === DOLLAR) &&
      (width === 2 || !isSpace(char(at - 1)))
    ) {
      return at;
    }
  }
  return -1;
}

export const math: MarkdownConfig = {
  defineNodes: ["MathBlock", "InlineMath", "MathMark"],
  parseBlock: [
    {
      name: "MathBlock",
      before: "FencedCode",
      parse(cx, line) {
        if (!opensMathBlock(line.text.slice(line.pos))) {
          return false;
        }
        const from = cx.lineStart + line.pos;
        const sameLine = line.text.indexOf("$$", line.pos + 2);
        if (sameLine >= 0) {
          const to = cx.lineStart + sameLine + 2;
          cx.nextLine();
          cx.addElement(cx.elt("MathBlock", from, to));
          return true;
        }
        while (cx.nextLine()) {
          const end = line.text.indexOf("$$");
          if (end >= 0) {
            const to = cx.lineStart + end + 2;
            cx.nextLine();
            cx.addElement(cx.elt("MathBlock", from, to));
            return true;
          }
        }
        cx.addElement(cx.elt("MathBlock", from, cx.prevLineEnd()));
        return true;
      },
      // As in Obsidian, a `$$` line starts display math even right after a
      // paragraph line, without a blank line between.
      endLeaf: (_cx, line) => opensMathBlock(line.text.slice(line.pos)),
    },
  ],
  parseInline: [
    {
      name: "Math",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== DOLLAR) {
          return -1;
        }
        const width = cx.char(pos + 1) === DOLLAR ? 2 : 1;
        const end = inlineMathEnd((at) => cx.char(at), pos, cx.end);
        if (end < 0) {
          return -1;
        }
        return cx.addElement(
          cx.elt("InlineMath", pos, end + width, [
            cx.elt("MathMark", pos, pos + width),
            cx.elt("MathMark", end, end + width),
          ]),
        );
      },
    },
  ],
};
