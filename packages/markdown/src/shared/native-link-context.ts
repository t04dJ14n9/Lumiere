/** Mask opaque Markdown contexts while preserving every UTF-16 source offset. */
export function nativeLinkContext(text: string): string {
  // Blocks first, then inline spans: a fence or code span decides whether a
  // `<!--` inside it counts, never the other way round.
  return maskInlineContexts(maskBlockContexts(text));
}

interface HtmlBlock {
  /** The text that ends the block; undefined means the next blank line. */
  end: RegExp | undefined;
}

interface BlockState {
  /** The opening fence run while inside fenced code. */
  fence: string;
  html: HtmlBlock | undefined;
  /** Whether the previous line was paragraph text. */
  paragraph: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const UNTIL_BLANK_LINE: HtmlBlock = { end: undefined };
// CommonMark HTML block start conditions 1, 2 and 6, in that order.
const RAW_ELEMENT = /^ {0,3}<(?:script|style|pre|textarea)(?=[\s>]|$)/i;
const RAW_ELEMENT_END = /<\/(?:script|style|pre|textarea)>/i;
const COMMENT_START = /^ {0,3}<!--/;
const BLOCK_TAG = new RegExp(
  "^ {0,3}</?(?:address|article|aside|base|basefont|blockquote|body|caption|" +
    "center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|" +
    "figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|" +
    "legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|" +
    "param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|" +
    "track|ul)(?=[\\s>]|/>|$)",
  "i",
);
// Condition 7: one complete open or closing tag and nothing else on the line.
// `<span>caption</span> text` is a paragraph, not an HTML block.
const LONE_TAG =
  /^ {0,3}(?:<[a-z][a-z0-9-]*(?:\s+[a-z_:][\w:.-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[a-z][a-z0-9-]*\s*>)\s*$/i;

function maskBlockContexts(text: string): string {
  const state: BlockState = { fence: "", html: undefined, paragraph: false };
  return text
    .split("\n")
    .map((line) => maskBlockLine(line, state))
    .join("\n");
}

function maskBlockLine(line: string, state: BlockState): string {
  const body = containerBody(line);
  if (state.fence) {
    if (closesFence(body, state.fence)) {
      state.fence = "";
    }
    return blank(line);
  }
  if (state.html && (state.html.end || body.trim())) {
    return maskHtmlLine(line, state.html, state);
  }
  state.html = undefined;
  const marker = FENCE.exec(body);
  if (marker) {
    state.fence = marker[1]!;
    state.paragraph = false;
    return blank(line);
  }
  const html = htmlBlockStart(body, state.paragraph);
  if (html) {
    state.html = html;
    state.paragraph = false;
    return maskHtmlLine(line, html, state);
  }
  const isCode = /^( {4}|\t)/.test(body);
  state.paragraph = !isCode && body.trim() !== "";
  return isCode ? blank(line) : line;
}

/** A comment or raw element ends mid-line; what follows it is still text. */
function maskHtmlLine(
  line: string,
  html: HtmlBlock,
  state: BlockState,
): string {
  const end = html.end?.exec(line);
  if (!end) {
    return blank(line);
  }
  state.html = undefined;
  const stop = end.index + end[0].length;
  return blank(line.slice(0, stop)) + line.slice(stop);
}

function htmlBlockStart(
  body: string,
  afterParagraph: boolean,
): HtmlBlock | undefined {
  if (RAW_ELEMENT.test(body)) {
    return { end: RAW_ELEMENT_END };
  }
  if (COMMENT_START.test(body)) {
    return { end: /-->/ };
  }
  if (BLOCK_TAG.test(body)) {
    return UNTIL_BLANK_LINE;
  }
  // Only this kind of block cannot interrupt a paragraph.
  return !afterParagraph && LONE_TAG.test(body) ? UNTIL_BLANK_LINE : undefined;
}

function closesFence(body: string, fence: string): boolean {
  const marker = FENCE.exec(body);
  return (
    marker !== null &&
    marker[1]![0] === fence[0] &&
    marker[1]!.length >= fence.length &&
    !marker[2]!.trim()
  );
}

function blank(value: string): string {
  return value.replace(/[^\r\n]/g, " ");
}

/** Quoted/list fences are still fences; their markers are not source text. */
function containerBody(line: string): string {
  let body = line;
  while (true) {
    const next = body.replace(/^ {0,3}(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)/, "");
    if (next === body) {
      return body;
    }
    body = next;
  }
}

/**
 * Code spans and inline comments: whichever starts first wins, so `` `<!--` ``
 * is code and a comment hides the backticks inside it. A code span pairs with
 * the next backtick run of exactly its length, across lines; unmatched ticks
 * stay literal. An unclosed inline `<!--` is literal too: only a block-level
 * one runs to the end of the note.
 */
function maskInlineContexts(text: string): string {
  const tokens = [...text.matchAll(/`+|<!--/g)];
  const closers = closingRuns(tokens);
  let result = "";
  let offset = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const end = escaped(text, token.index)
      ? undefined
      : spanEnd(text, token, closers.get(index));
    if (end === undefined) {
      continue;
    }
    result +=
      text.slice(offset, token.index) + blank(text.slice(token.index, end));
    offset = end;
    while (tokens[index + 1] && tokens[index + 1]!.index < end) {
      index++;
    }
  }
  return result + text.slice(offset);
}

function spanEnd(
  text: string,
  token: RegExpExecArray,
  close: RegExpExecArray | undefined,
): number | undefined {
  if (token[0] === "<!--") {
    const end = text.indexOf("-->", token.index + token[0].length);
    return end < 0 ? undefined : end + 3;
  }
  return close && close.index + close[0].length;
}

/** For each backtick run, the next run of exactly the same length. */
function closingRuns(tokens: RegExpExecArray[]): Map<number, RegExpExecArray> {
  const closers = new Map<number, RegExpExecArray>();
  const later = new Map<number, RegExpExecArray>();
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index]!;
    if (token[0] === "<!--") {
      continue;
    }
    const next = later.get(token[0].length);
    if (next) {
      closers.set(index, next);
    }
    later.set(token[0].length, token);
  }
  return closers;
}

function escaped(text: string, at: number): boolean {
  let count = 0;
  while (at > 0 && text[--at] === "\\") {
    count++;
  }
  return count % 2 === 1;
}
