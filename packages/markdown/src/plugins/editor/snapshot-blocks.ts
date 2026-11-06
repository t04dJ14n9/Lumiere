import type { SyntaxNode } from "@lezer/common";
import { escape } from "../../markdown/html/helpers";
import { listDepth, markerWidth } from "../../markdown/list-layout";
import { inline, row, span, type Lines, type Source } from "./snapshot-inline";

/** Blocks Live Preview draws as plain lines, each drawn by the function below it. */

/**
 * Languages whose fences Live Preview draws as plain code lines. Others may
 * be claimed by a diagram, query or code-processor renderer, which are
 * widgets of another height.
 */
const CODE_LANGUAGES = new Set(
  "ts typescript js javascript jsx tsx json bash sh shell zsh python py css scss html xml yaml yml go rust rs java c cpp cs sql diff md markdown text txt toml ini php ruby rb swift kotlin".split(
    " ",
  ),
);

/** The text of a heading's line; line 1 shows its `#`, where the caret starts. */
function headingHtml(
  src: Source,
  node: SyntaxNode,
  line: number,
): string | undefined {
  const marks = node.getChildren("HeaderMark");
  const first = marks[0]!;
  const end = src.end(line);
  if (!src.text.slice(first.to, end).trim()) {
    return undefined;
  }
  if (line > 0) {
    return inline(src, node, src.starts[line]!, end);
  }
  const space = src.text[first.to] === " ";
  const rest = inline(src, node, first.to + (space ? 1 : 0), end);
  if (rest === undefined || marks.length !== 1 || first.from !== 0) {
    return undefined;
  }
  return (
    span("md-syntax-mark", escape(src.text.slice(0, first.to))) +
    (space ? span("md-header-space", " ") : "") +
    rest
  );
}

export function heading(src: Source, node: SyntaxNode, lines: Lines): boolean {
  const line = src.line(node.from);
  const html = headingHtml(src, node, line);
  if (html === undefined) {
    return false;
  }
  const position = line === 0 ? " is-first-line" : "";
  lines[line] = row(
    `cm-line md-heading md-h${node.name.at(-1)}${position}`,
    html,
  );
  return true;
}

export function paragraph(
  src: Source,
  node: SyntaxNode,
  lines: Lines,
): boolean {
  // An element at offset 0 shows its syntax: the caret starts there.
  if (node.from === 0 && node.firstChild?.from === 0) {
    return false;
  }
  for (let at = src.line(node.from); at <= src.line(node.to); at++) {
    const html = inline(src, node, src.starts[at]!, src.end(at));
    if (html === undefined) {
      return false;
    }
    lines[at] = row("cm-line", html);
  }
  return true;
}

export function list(src: Source, node: SyntaxNode, lines: Lines): boolean {
  if (node.from === 0) {
    return false;
  }
  for (let item = node.firstChild; item; item = item.nextSibling) {
    if (item.name !== "ListItem" || !listItem(src, item, lines)) {
      return false;
    }
  }
  return true;
}

/** An item of one line, and any nested lists; wrapped or task items are left out. */
function listItem(src: Source, item: SyntaxNode, lines: Lines): boolean {
  const mark = item.getChild("ListMark");
  const text = item.getChild("Paragraph");
  const at = src.line(item.from);
  const leading = src.text.slice(src.starts[at]!, item.from);
  if (!mark || !text || src.line(text.to) !== at || /\S/.test(leading)) {
    return false;
  }
  for (let child = item.firstChild; child; child = child.nextSibling) {
    const isList = child.name === "BulletList" || child.name === "OrderedList";
    const isPart = child.name === "ListMark" || child.from === text.from;
    if (isList ? !list(src, child, lines) : !isPart) {
      return false;
    }
  }
  const start = mark.to + (src.text[mark.to] === " " ? 1 : 0);
  const body = inline(src, text, start, src.end(at));
  if (body === undefined) {
    return false;
  }
  const depth = listDepth(item);
  const marker = src.text.slice(mark.from, mark.to);
  const indent = leading
    ? `<span class="md-list-indent" style="--list-depth: ${depth}"></span>`
    : "";
  const shown = /^[-+*]$/.test(marker)
    ? span("list-bullet", "•")
    : span("md-list-number", escape(src.text.slice(mark.from, start)));
  lines[at] = row(
    "cm-line md-list-line",
    indent + shown + body,
    `--list-depth: ${depth}; --list-marker: ${markerWidth(marker, false)}`,
  );
  return true;
}

/** A one-level quote of paragraphs; nested quotes, callouts and blocks inside are left out. */
export function quote(src: Source, node: SyntaxNode, lines: Lines): boolean {
  const marks = node.getChildren("QuoteMark");
  const paragraphs = node.getChildren("Paragraph");
  const isPlain = (child: SyntaxNode) =>
    child.name === "QuoteMark" || child.name === "Paragraph";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!isPlain(child) || node.from === 0) {
      return false;
    }
  }
  for (let at = src.line(node.from); at <= src.line(node.to); at++) {
    const mark = marks.find((candidate) => src.line(candidate.from) === at);
    const start = mark ? mark.to + (src.text[mark.to] === " " ? 1 : 0) : 0;
    const end = src.end(at);
    const text = paragraphs.find((p) => p.from <= end && p.to >= start);
    const html = text && start < end ? inline(src, text, start, end) : "";
    const isCallout = /^\s*\[!/.test(src.text.slice(start, end));
    if (!mark || html === undefined || isCallout) {
      return false;
    }
    lines[at] = row("cm-line md-quote", html, "--quote-depth: 1");
  }
  return true;
}

/** A closed, unindented fence of a plain language, as its code lines. */
export function fence(src: Source, node: SyntaxNode, lines: Lines): boolean {
  const open = src.line(node.from);
  const close = src.line(node.to);
  const info = node.getChild("CodeInfo");
  const language = info ? src.text.slice(info.from, info.to).trim() : "";
  const isClosed = node.getChildren("CodeMark").length > 1 && close > open;
  const isIndented = src.starts[open] !== node.from;
  const isPlain = !language || CODE_LANGUAGES.has(language.toLowerCase());
  if (node.from === 0 || !isClosed || isIndented || !isPlain) {
    return false;
  }
  const code = "cm-line md-code-line";
  lines[open] = row(`${code} md-code-fence md-code-fence-open`, "");
  for (let at = open + 1; at < close; at++) {
    lines[at] = row(code, escape(src.text.slice(src.starts[at]!, src.end(at))));
  }
  lines[close] = row(`${code} md-code-fence md-code-fence-close`, "");
  return true;
}

/** A thematic break is one empty line with the rule drawn on it. */
export function rule(src: Source, node: SyntaxNode, lines: Lines): boolean {
  if (node.from === 0) {
    return false;
  }
  lines[src.line(node.from)] = row("cm-line md-hr-line", "");
  return true;
}
