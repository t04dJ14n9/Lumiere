import type { SyntaxNode } from "@lezer/common";
import { highlightColourAt } from "../../markdown/dialect/highlight";
import { escape, linkDestination } from "../../markdown/html/helpers";
import { linkClass } from "../../markdown/link-class";

const STYLED = new Map([
  ["StrongEmphasis", "md-strong"],
  ["Emphasis", "md-emphasis"],
  ["Strikethrough", "md-strike"],
  ["Highlight", "md-highlight"],
  ["InlineCode", "md-inline-code"],
]);

/** Syntax Live Preview hides while the caret is elsewhere. */
const HIDDEN_MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "HighlightMark",
  "CodeMark",
  "HeaderMark",
  "QuoteMark",
]);

/** The note's text split into lines, with the offset where each starts. */
export class Source {
  readonly starts: number[] = [0];
  constructor(
    readonly text: string,
    /** Whether tags are drawn as tags: the tags plugin is on. */
    readonly hasTags: boolean,
  ) {
    for (
      let at = text.indexOf("\n");
      at >= 0;
      at = text.indexOf("\n", at + 1)
    ) {
      this.starts.push(at + 1);
    }
  }
  get lineCount(): number {
    return this.starts.length;
  }
  /** The index of the line holding `offset`. */
  line(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }
  end(line: number): number {
    return line + 1 < this.starts.length
      ? this.starts[line + 1]! - 1
      : this.text.length;
  }
  isBlank(line: number): boolean {
    return !/\S/.test(this.text.slice(this.starts[line]!, this.end(line)));
  }
}

/**
 * Where syntax is hidden the editor leaves a zero-width image either side
 * (CodeMirror's widget buffers), and a line may break at an image, so `a**b**,`
 * can wrap between `b` and `,`. A `<wbr>` is the same break opportunity.
 */
const WBR = "<wbr>";

/** The HTML of each source line; undefined where nothing draws it. */
export type Lines = (string | undefined)[];

export const span = (cls: string, html: string) =>
  `<span class="${cls}">${html}</span>`;
export const row = (cls: string, html: string, style?: string) =>
  `<div class="${cls}"${style ? ` style="${style}"` : ""}>${html || "<br>"}</div>`;

/**
 * The text of `parent`'s inline children between `from` and `to`, as Live
 * Preview draws it with the caret elsewhere. Undefined for anything this
 * does not draw exactly (images, tags, math, footnotes, HTML, an element
 * crossing a line break), so that block and everything after it are left out.
 */
export function inline(
  src: Source,
  parent: SyntaxNode,
  from: number,
  to: number,
): string | undefined {
  let html = "";
  let at = from;
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.to <= from) {
      continue;
    }
    if (child.from >= to) {
      break;
    }
    const part =
      child.from < from || child.to > to ? undefined : inlineNode(src, child);
    if (part === undefined) {
      return undefined;
    }
    html += escape(src.text.slice(at, child.from)) + part;
    at = child.to;
    // A hidden heading or quote mark takes the space after it along.
    if (
      (child.name === "HeaderMark" || child.name === "QuoteMark") &&
      src.text[at] === " "
    ) {
      at++;
    }
  }
  return html + escape(src.text.slice(at, to));
}

function inlineNode(src: Source, node: SyntaxNode): string | undefined {
  if (HIDDEN_MARKS.has(node.name)) {
    return WBR;
  }
  const styled = STYLED.get(node.name);
  // A coloured highlight (`==🔵text==`) hides its emoji and takes its colour.
  const isColoured =
    node.name === "Highlight" &&
    highlightColourAt(src.text.slice(node.from + 2, node.from + 4));
  if (styled && !isColoured) {
    const html = inline(src, node, node.from, node.to);
    if (html === undefined) {
      return undefined;
    }
    // The marks' break opportunities sit outside the styled span, as the
    // editor's: a break inside would leave the span's padding behind.
    const hasMarks = html.startsWith(WBR) && html.endsWith(WBR);
    return hasMarks
      ? WBR + span(styled, html.slice(WBR.length, -WBR.length)) + WBR
      : span(styled, html);
  }
  switch (node.name) {
    case "Link":
      return link(src, node);
    case "WikiLink":
      return wikiLink(src, node);
    case "URL":
      return span(
        "md-link md-link-rendered",
        escape(src.text.slice(node.from, node.to)),
      );
    case "Tag": {
      const tag = escape(src.text.slice(node.from, node.to));
      return src.hasTags ? span("md-tag", tag) : tag;
    }
    case "Escape":
      return WBR + escape(src.text.slice(node.from + 1, node.to));
    default:
      return undefined;
  }
}

/** `[label](address)`: the label, as a rendered link. */
function link(src: Source, node: SyntaxNode): string | undefined {
  const url = node.getChild("URL");
  const closing = node.getChildren("LinkMark")[1];
  if (!url || !closing) {
    return undefined;
  }
  const label = inline(src, node, node.from + 1, closing.from);
  const href = linkDestination(src.text.slice(url.from, url.to));
  return label === undefined
    ? undefined
    : WBR + span(linkClass(true, href), label) + WBR;
}

/** `[[Note|label]]` shows `label`; `[[#Heading]]` shows `Heading`. */
function wikiLink(src: Source, node: SyntaxNode): string {
  const text = src.text.slice(node.from + 2, node.to - 2);
  const separator = text.indexOf("|");
  const isLocal = separator < 0 && text.length > 1 && text.startsWith("#");
  const start = separator < 0 ? Number(isLocal) : separator + 1;
  return (
    WBR + span("md-link md-link-rendered", escape(text.slice(start))) + WBR
  );
}
