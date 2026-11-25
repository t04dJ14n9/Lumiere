import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "../../markdown/dialect/parser";
import { escape } from "../../markdown/html/helpers";
import {
  frontmatterPlaceholderHeight,
  FRONTMATTER_PLACEHOLDER_CLASS,
  frontmatterPlaceholderMarkup,
  FRONTMATTER_PROBE_MAX,
} from "../../markdown/properties/frontmatter-placeholder";
import { headerParts } from "../../markdown/properties/header-parts";
import type { NoteSettings } from "../../shared/host";
import type { Platform } from "./font";
import { config as editorConfig } from "./manifest";
import {
  SNAPSHOT_CLASS,
  snapshotLayout,
  type SnapshotLayout,
} from "./snapshot-layout";
import {
  fence,
  heading,
  list,
  paragraph,
  quote,
  rule,
} from "./snapshot-blocks";
import { row, Source, type Lines } from "./snapshot-inline";

/**
 * A note's first screen as inert markup in the webview's first HTML, so the
 * text is on screen before the editor's script has loaded. It draws what
 * Live Preview draws for plain blocks (headings, paragraphs with basic
 * formatting and links, lists, quotes, code lines, rules, the Properties
 * placeholder) with Live Preview's own classes, and ends before the first
 * block it cannot draw exactly: tables, callouts, images, embeds, math,
 * tags, footnotes, HTML. The editor mounts under it (webview/snapshot.ts).
 */

/** The first screen is at most this many lines and characters of source. */
const MAX_LINES = 80;
const MAX_CHARS = 8192;
/** Frontmatter values the placeholder's height still fits (see `isEstimable`). */
const MAX_YAML_LINE = 80;
const MAX_LIST_ITEMS = 5;

/**
 * The three gutter columns of the settled editor, empty: the text starts
 * where it does once line numbers, change bars and fold markers have mounted.
 * The editor's own stylesheet sizes them (`#app .cm-lineNumbers` and friends).
 */
const GUTTERS =
  '<div class="mw-snapshot-gutters">' +
  '<div class="cm-gutter cm-lineNumbers"><div class="cm-gutterElement" style="height:0">99999</div></div>' +
  '<div class="cm-gutter mw-git-gutter"></div>' +
  '<div class="cm-gutter cm-foldGutter"><div class="cm-gutterElement" style="height:0"></div></div>' +
  "</div>";

/**
 * Whether the sheet is about as tall as the placeholder's estimate: a few
 * short one-line values and short lists. A nested map, a long value that
 * wraps or an empty sheet is taller than the estimate, which only floors it.
 */
function isEstimable(yaml: string): boolean {
  let rows = 0;
  let items = 0;
  for (const line of yaml.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    if (
      line.length > MAX_YAML_LINE ||
      (/^\s/.test(line) && !/^\s*-\s/.test(line))
    ) {
      return false;
    }
    if (/^\s*-\s/.test(line)) {
      items++;
    } else {
      rows++;
    }
  }
  return rows > 0 && items <= MAX_LIST_ITEMS;
}

/**
 * A complete fence is a Properties sheet. Properties draws it later, so the
 * snapshot reserves the height the editor reserves until the sheet mounts.
 * Returns false after drawing it when the real sheet may be taller: the
 * lines below would then move at the swap, so the snapshot ends here.
 */
function frontmatter(
  src: Source,
  node: SyntaxNode,
  lines: Lines,
  layout: SnapshotLayout,
): boolean {
  const header = headerParts(src.text);
  if (!layout.properties || !header || node.to < header.end - 1) {
    return false;
  }
  const height = frontmatterPlaceholderHeight(src.text);
  lines[0] =
    `<div class="${FRONTMATTER_PLACEHOLDER_CLASS}" style="min-height:${height}px">` +
    `${frontmatterPlaceholderMarkup()}</div>`;
  for (let at = 1; at <= src.line(node.to); at++) {
    lines[at] = "";
  }
  return isEstimable(header.body);
}

/** Draws one top-level block into `lines`; false when it cannot. */
function block(
  src: Source,
  node: SyntaxNode,
  lines: Lines,
  layout: SnapshotLayout,
): boolean {
  const { name } = node;
  if (/^ATXHeading[1-6]$/.test(name)) {
    return heading(src, node, lines);
  }
  switch (name) {
    case "Paragraph":
      return paragraph(src, node, lines);
    case "BulletList":
    case "OrderedList":
      return list(src, node, lines);
    case "Blockquote":
      return quote(src, node, lines);
    case "FencedCode":
      return fence(src, node, lines);
    case "Frontmatter":
      return frontmatter(src, node, lines, layout);
    case "HorizontalRule":
      return rule(src, node, lines);
    default:
      return false;
  }
}

/**
 * Whole lines of the source within the caps. The frontmatter, which the
 * snapshot draws as one placeholder, does not count toward them.
 */
function firstScreenSource(
  source: string,
  isEnd: boolean,
): { text: string; isWhole: boolean } {
  const fence = headerParts(source.slice(0, FRONTMATTER_PROBE_MAX))?.end ?? 0;
  let body = source.slice(fence, fence + MAX_CHARS);
  if (fence + body.length < source.length) {
    body = body.slice(0, Math.max(body.lastIndexOf("\n"), 0));
  }
  const lines = body.split("\n");
  if (lines.length > MAX_LINES) {
    body = lines.slice(0, MAX_LINES).join("\n");
  }
  const text = source.slice(0, fence) + body;
  return { text, isWhole: isEnd && text.length === source.length };
}

/**
 * The note's first lines as Live Preview draws them: the lines the blocks
 * before the first one that cannot be drawn cover, with the blank lines
 * between them. Undefined when no block can be drawn.
 */
function firstScreen(
  source: string,
  layout: SnapshotLayout,
): { html: string; isComplete: boolean } | undefined {
  // Only the start of the note is read, so a huge note is not copied whole.
  const prefix = source.slice(0, FRONTMATTER_PROBE_MAX + 2 * MAX_CHARS);
  const head = firstScreenSource(
    prefix.replace(/\r\n?/g, "\n"),
    prefix.length === source.length,
  );
  const src = new Source(head.text, layout.tags);
  const blocks: SyntaxNode[] = [];
  const tree = markdownParser.parse(head.text);
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    blocks.push(node);
  }
  // A block that reaches the cut may continue beyond it (a paragraph over
  // a `===` line, say); one with a blank line after it cannot change.
  const last = blocks.at(-1);
  if (!head.isWhole && last && src.line(last.to) === src.lineCount - 1) {
    blocks.pop();
  }
  const lines: Lines = new Array<string | undefined>(src.lineCount);
  for (const node of blocks) {
    if (!block(src, node, lines, layout)) {
      break;
    }
  }
  const drawn: string[] = [];
  let hasBlock = false;
  let at = 0;
  for (; at < lines.length; at++) {
    const line = lines[at];
    const html = line ?? (src.isBlank(at) ? row("cm-line", "") : undefined);
    if (html === undefined) {
      break;
    }
    hasBlock ||= line !== undefined;
    drawn.push(html);
  }
  if (!hasBlock) {
    return undefined;
  }
  return {
    html: drawn.join(""),
    isComplete: head.isWhole && at === lines.length,
  };
}

/**
 * The snapshot element for the webview's first HTML, or undefined when
 * nothing can be drawn. `layout` says what it assumes of the settings.
 */
function snapshotHTML(
  source: string,
  layout: SnapshotLayout,
): string | undefined {
  const screen = firstScreen(source, layout);
  if (!screen) {
    return undefined;
  }
  const vars = Object.entries(layout.vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  const cls = SNAPSHOT_CLASS + (screen.isComplete ? "" : " is-truncated");
  return (
    `<div class="${cls}" aria-hidden="true" data-layout="${escape(layout.key)}" style="${escape(vars)}">` +
    GUTTERS +
    `<div class="mw-snapshot-text" style="tab-size:${layout.tabSize}">${screen.html}</div></div>`
  );
}

/**
 * The snapshot for a note with these settings, or "" when the setting is off
 * or the settings are ones the snapshot cannot match (see `snapshotLayout`).
 */
export function webviewSnapshot(
  source: string,
  note: NoteSettings,
  platform: Platform,
): string {
  if (!editorConfig.parse(note.editor ?? {}).firstPaintSnapshot) {
    return "";
  }
  const layout = snapshotLayout(note, platform);
  return (layout && snapshotHTML(source, layout)) ?? "";
}
