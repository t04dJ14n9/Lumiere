/**
 * The sidecar Markdown file that keeps a PDF's highlights, so the PDF itself
 * is never written. Front matter names the PDF; each highlight is an HTML
 * comment block, so the file stays Markdown a reader can write notes in:
 *
 *     ---
 *     lumiere-pdf-sidecar: 1
 *     source: paper.pdf
 *     ---
 *
 *     <!-- lumiere-highlight
 *     id: hl-a1b2c3d4
 *     page: 3
 *     subtype: highlight
 *     color: "#FFE566"
 *     opacity: 0.45
 *     segmentRects:
 *       - { x: 72, y: 410, w: 220, h: 12 }
 *     quote: "scaled dot-product attention"
 *     contextBefore: "We propose "
 *     contextAfter: " as the core of the Transformer."
 *     created: 2026-11-01T18:00:00.000Z
 *     modified: 2026-11-01T18:00:00.000Z
 *     -->
 *
 * Rectangles are in points from the page's top-left corner, as `viewrect`.
 * Strings are JSON-quoted with `>` escaped, so no value can end the comment.
 * Edits touch only the block they are about: the reader's prose is kept.
 */

export const SIDECAR_VERSION = 1;

/** One line's box of a highlight, in points from the page's top-left. */
export interface SegmentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SidecarHighlight {
  /** As written in the file; see `highlightFragment` for the link. */
  id: string;
  /** 1-based. */
  page: number;
  subtype: "highlight";
  /** `#RRGGBB`. */
  color: string;
  opacity: number;
  segmentRects: SegmentRect[];
  quote: string;
  contextBefore: string;
  contextAfter: string;
  created: string;
  modified: string;
}

export interface SidecarFile {
  /** `lumiere-pdf-sidecar` from the front matter, when there is one. */
  version?: number;
  /** The PDF's file name. */
  source?: string;
  /** The PDF's workspace-relative path, written for sidecars kept in a folder. */
  path?: string;
  highlights: SidecarHighlight[];
}

export const DEFAULT_HIGHLIGHT_COLOR = "#FFE566";
export const DEFAULT_HIGHLIGHT_OPACITY = 0.45;
/** The longest quote kept; a longer selection is cut here. */
export const MAX_QUOTE_LENGTH = 2_000;
/** How much text around the quote is kept to find it again. */
export const CONTEXT_LENGTH = 40;

const BLOCK = /<!--[ \t]*lumiere-highlight\b([\s\S]*?)-->/g;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ID = /^(?:hl-)?[A-Za-z0-9_-]{1,64}$/;

/** Whether `value` can be a highlight id: URL-safe, at most 64 characters. */
export function isHighlightId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/** The link fragment of a highlight: `hl-` and the id, never `hl-hl-`. */
export function highlightFragment(id: string): string {
  return id.startsWith("hl-") ? id : `hl-${id}`;
}

/** A new id from 8 random hex digits, such as `hl-a1b2c3d4`. */
export function newHighlightId(randomHex: () => string): string {
  return `hl-${randomHex().slice(0, 8)}`;
}

/** The highlight a link fragment names (`hl-…`, alone or among `&` parameters). */
export function highlightIdOfFragment(fragment: string): string | undefined {
  for (const part of fragment.replace(/^#/, "").split("&")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      continue;
    }
    if (decoded.startsWith("hl-") && isHighlightId(decoded)) {
      return decoded;
    }
  }
  return undefined;
}

/** The highlights and front matter of a sidecar. Blocks that do not parse are skipped. */
export function parseSidecar(text: string): SidecarFile {
  const file: SidecarFile = { highlights: [] };
  const front = FRONT_MATTER.exec(text);
  if (front) {
    const fields = parseFields(front[1]!);
    const version = Number(fields.get("lumiere-pdf-sidecar"));
    if (Number.isSafeInteger(version)) {
      file.version = version;
    }
    const source = scalar(fields.get("source"));
    if (source) {
      file.source = source;
    }
    const path = scalar(fields.get("path"));
    if (path) {
      file.path = path;
    }
  }
  for (const match of text.matchAll(BLOCK)) {
    const highlight = parseHighlight(match[1]!);
    if (highlight) {
      file.highlights.push(highlight);
    }
  }
  return file;
}

/** A new sidecar for the PDF named `source`, with these highlights. */
export function createSidecar(
  owner: { source: string; path?: string },
  highlights: readonly SidecarHighlight[],
): string {
  const front = [
    "---",
    `lumiere-pdf-sidecar: ${SIDECAR_VERSION}`,
    `source: ${quote(owner.source)}`,
    ...(owner.path ? [`path: ${quote(owner.path)}`] : []),
    "---",
    "",
  ];
  const blocks = highlights.map(
    (highlight) => `${formatHighlight(highlight)}\n`,
  );
  return [...front, ...blocks, "## Notes", ""].join("\n");
}

/**
 * The sidecar with `highlight` written: in place of the block with its id, or
 * after the last highlight (after the front matter when there is none).
 */
export function upsertHighlight(
  text: string,
  highlight: SidecarHighlight,
): string {
  const block = formatHighlight(highlight);
  const existing = findBlock(text, highlight.id);
  if (existing) {
    return text.slice(0, existing.start) + block + text.slice(existing.end);
  }
  // One blank line on each side of the new block; the rest is left as it is.
  const at = insertionPoint(text);
  const before = text.slice(0, at).trimEnd();
  const after = text.slice(at).trimStart();
  const head = before ? `${before}\n\n` : "";
  const tail = after ? `\n\n${after}` : "\n";
  return `${head}${block}${tail}`;
}

/** The sidecar without the block of highlight `id` (unchanged when it has none). */
export function removeHighlight(text: string, id: string): string {
  const existing = findBlock(text, id);
  if (!existing) {
    return text;
  }
  let end = existing.end;
  // Take the blank line that separated the block from what follows.
  const rest = /^[ \t]*\r?\n(?:[ \t]*\r?\n)?/.exec(text.slice(end));
  end += rest ? rest[0].length : 0;
  return text.slice(0, existing.start) + text.slice(end);
}

/** One highlight as its comment block, without a trailing newline. */
export function formatHighlight(highlight: SidecarHighlight): string {
  const rects = highlight.segmentRects.map(
    ({ x, y, w, h }) =>
      `  - { x: ${round(x)}, y: ${round(y)}, w: ${round(w)}, h: ${round(h)} }`,
  );
  return [
    "<!-- lumiere-highlight",
    `id: ${highlight.id}`,
    `page: ${highlight.page}`,
    `subtype: ${highlight.subtype}`,
    `color: ${quote(highlight.color)}`,
    `opacity: ${round(highlight.opacity)}`,
    "segmentRects:",
    ...rects,
    `quote: ${quote(highlight.quote)}`,
    `contextBefore: ${quote(highlight.contextBefore)}`,
    `contextAfter: ${quote(highlight.contextAfter)}`,
    `created: ${highlight.created}`,
    `modified: ${highlight.modified}`,
    "-->",
  ].join("\n");
}

function findBlock(
  text: string,
  id: string,
): { start: number; end: number } | undefined {
  for (const match of text.matchAll(BLOCK)) {
    if (parseFields(match[1]!).get("id") === id) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return undefined;
}

function insertionPoint(text: string): number {
  let end: number | undefined;
  for (const match of text.matchAll(BLOCK)) {
    end = match.index + match[0].length;
  }
  if (end !== undefined) {
    return end;
  }
  const front = FRONT_MATTER.exec(text);
  return front ? front[0].length : 0;
}

function parseHighlight(body: string): SidecarHighlight | undefined {
  const fields = parseFields(body);
  const id = fields.get("id");
  const page = Number(fields.get("page"));
  const segmentRects = parseRects(body);
  if (
    !isHighlightId(id) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    segmentRects.length === 0
  ) {
    return undefined;
  }
  const color = scalar(fields.get("color")) ?? "";
  const opacity = Number(fields.get("opacity"));
  return {
    id,
    page,
    subtype: "highlight",
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_HIGHLIGHT_COLOR,
    opacity:
      Number.isFinite(opacity) && opacity > 0 && opacity <= 1
        ? opacity
        : DEFAULT_HIGHLIGHT_OPACITY,
    segmentRects,
    quote: scalar(fields.get("quote")) ?? "",
    contextBefore: scalar(fields.get("contextBefore")) ?? "",
    contextAfter: scalar(fields.get("contextAfter")) ?? "",
    created: scalar(fields.get("created")) ?? "",
    modified: scalar(fields.get("modified")) ?? "",
  };
}

/** `key: value` lines at the start of a line; the value as written. */
function parseFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (match && !fields.has(match[1]!)) {
      fields.set(match[1]!, match[2]!.trim());
    }
  }
  return fields;
}

/** The `- { x: …, y: …, w: …, h: … }` lines; boxes that are not boxes are dropped. */
function parseRects(body: string): SegmentRect[] {
  const rects: SegmentRect[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*-\s*\{(.*)\}\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const values = new Map<string, number>();
    for (const pair of match[1]!.split(",")) {
      const [key, value] = pair.split(":");
      values.set(key?.trim() ?? "", Number(value));
    }
    const rect = {
      x: values.get("x") ?? NaN,
      y: values.get("y") ?? NaN,
      w: values.get("w") ?? NaN,
      h: values.get("h") ?? NaN,
    };
    if (
      Object.values(rect).every(Number.isFinite) &&
      rect.w > 0 &&
      rect.h > 0
    ) {
      rects.push(rect);
    }
  }
  return rects;
}

/** A value as written: JSON-quoted, or bare. */
function scalar(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return value;
}

/** JSON-quoted, with `>` escaped so the value can never close the comment. */
function quote(value: string): string {
  return JSON.stringify(value).replace(/>/g, "\\u003e");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The one replacement that turns `before` into `after`: the changed middle
 * between their common start and end. An open editor of the sidecar then
 * keeps its place and the reader's undo history around the edit.
 */
export function changedSpan(
  before: string,
  after: string,
): { start: number; end: number; text: string } | undefined {
  if (before === after) {
    return undefined;
  }
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) {
    start++;
  }
  let tail = 0;
  while (
    tail < shortest - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    start,
    end: before.length - tail,
    text: after.slice(start, after.length - tail),
  };
}

/** Whether a parsed sidecar belongs to the PDF `owner` describes. */
export function sidecarBelongsTo(
  file: Pick<SidecarFile, "source" | "path">,
  owner: { source: string; path?: string },
): boolean {
  if (file.source !== undefined && file.source !== owner.source) {
    return false;
  }
  return !(file.path && owner.path && file.path !== owner.path);
}
