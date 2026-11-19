import type { MarkdownIt } from "markdown-it";
import type { StateInline } from "markdown-it";
import type { StateBlock } from "markdown-it";
import { attr, encodeDataValue, escape } from "./helpers";
import { inlineMathEnd, opensMathBlock } from "../dialect/math";
export function math(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "math", inlineMath);
  md.renderer.rules.math_inline = (tokens, index) =>
    mathHTML(tokens[index]!.content, false);
  md.renderer.rules.math_block = (tokens, index) =>
    mathHTML(tokens[index]!.content, true);

  md.block.ruler.before("fence", "math_block", blockMath, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}

const mathHTML = (expression: string, display: boolean): string =>
  `<span class="math-placeholder${display ? " math-display" : ""}"${attr("data-math", encodeDataValue(expression))}${attr("data-display", String(display))}>${escape(expression)}</span>`;

function inlineMath(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== "$") {
    return false;
  }
  const width = state.src.startsWith("$$", state.pos) ? 2 : 1;
  const end = inlineMathEnd(
    (at) => state.src.charCodeAt(at),
    state.pos,
    state.posMax,
  );
  if (end < 0) {
    return false;
  }
  if (!silent) {
    const token = state.push(width === 2 ? "math_block" : "math_inline", "", 0);
    token.content = state.src.slice(state.pos + width, end);
  }
  state.pos = end + width;
  return true;
}

function blockMath(
  state: StateBlock,
  start: number,
  end: number,
  silent: boolean,
): boolean {
  const first = state.src.slice(
    state.bMarks[start]! + state.tShift[start]!,
    state.eMarks[start],
  );
  if (!opensMathBlock(first) || state.sCount[start]! - state.blkIndent >= 4) {
    return false;
  }
  let last = start;
  let content = first.slice(2);
  let closing = content.indexOf("$$");
  let trailing = "";
  while (closing < 0 && last + 1 < end) {
    last++;
    const line = state.src.slice(
      state.bMarks[last]! + state.tShift[last]!,
      state.eMarks[last],
    );
    const found = line.indexOf("$$");
    if (found >= 0) {
      content += "\n" + line.slice(0, found);
      closing = content.length;
      trailing = line.slice(found + 2).trim();
    } else {
      content += "\n" + line;
    }
  }
  if (closing < 0) {
    return false;
  }
  if (silent) {
    return true;
  }
  const token = state.push("math_block", "", 0);
  token.block = true;
  token.content = content.slice(0, closing).trim();
  token.map = [start, last + 1];
  pushTrailingParagraph(state, trailing, last);
  state.line = last + 1;
  return true;
}

/**
 * The text after a formula's closing `$$` on a later line, as its own
 * paragraph, as the editor's parser reads it (dialect/math.ts).
 */
function pushTrailingParagraph(
  state: StateBlock,
  text: string,
  line: number,
): void {
  if (!text) {
    return;
  }
  const map: [number, number] = [line, line + 1];
  state.push("paragraph_open", "p", 1).map = map;
  const inline = state.push("inline", "", 0);
  inline.content = text;
  inline.map = map;
  inline.children = [];
  state.push("paragraph_close", "p", -1);
}
