import { escape, wikiTarget } from "../html/helpers";
import { validTag } from "../tags/grammar";
import { inferPropertyKind, type PropertyKind } from "./types";
import { t } from "@workshop/l10n";

/**
 * The Properties sheet's rows read from a frontmatter body by a line scan, no
 * YAML parse, so the YAML runtime stays out of the first paint. The skeleton
 * is the sheet drawn before Properties exists: the snapshot and Live Preview's
 * placeholder both show it, with the real sheet's classes, so the browser
 * lays it out as it will lay the sheet out (wrapping text, wrapping chips,
 * clamped paragraphs) at whatever width the pane has. A row the scan cannot
 * read is drawn as one line of its source and makes the sheet inexact.
 */

export type SkeletonValue =
  | { type: "text"; text: string }
  | { type: "link"; label: string }
  | { type: "number" | "date" | "datetime"; text: string }
  | { type: "checkbox"; checked: boolean }
  | { type: "list"; kind: "list" | "tags" | "aliases"; items: string[] }
  | { type: "opaque"; text: string };

export interface SkeletonRow {
  key: string;
  value: SkeletonValue;
}

export interface SkeletonSheet {
  rows: SkeletonRow[];
  /**
   * Whether every row is a kind the skeleton draws in the box the sheet will
   * use. Then the text below a skeleton does not move when the sheet replaces
   * it; otherwise the real sheet may be taller or shorter.
   */
  isExact: boolean;
}

/** A top-level `key:` line and the lines that belong to it. */
interface Entry {
  key: string;
  /** What follows the colon on the key's line, without a comment. */
  rest: string;
  items: string[];
  /** An indented line that is not a list item: a nested map or a wrapped scalar. */
  isNested: boolean;
}

/** A value the scan could not read; its row is drawn as one line of source. */
const UNREADABLE = Symbol("unreadable");
type Scalar = string | number | boolean | null | typeof UNREADABLE;

const KEY_LINE = /^(.+?):(?:\s+(.*?))?\s*$/;
const LIST_ITEM = /^\s*-(?:\s+(.*?))?\s*$/;
/** What a plain scalar cannot start with (flow brackets and commas included: `[a` is no string). */
const INDICATOR_START = /^[&*!|>%@`?[\]{},]|^[-:](?:\s|$)/;

function entryOf(line: string): Entry | undefined {
  const match = KEY_LINE.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    key: match[1]!.trim(),
    rest: stripComment(match[2] ?? ""),
    items: [],
    isNested: false,
  };
}

/**
 * Drops ` # comment` after a value; a `#` inside quotes stays. After a closing
 * quote only a comment may follow, as YAML reads it: anything else (`"a" b`)
 * leaves the text whole for `quotedScalar` to refuse.
 */
function stripComment(text: string): string {
  if (text.startsWith("#")) {
    return "";
  }
  const quote = /^(["'])/.exec(text)?.[1];
  if (quote) {
    const end = closingQuote(text, quote);
    const rest = text.slice(end + 1);
    return end < 0 || (rest.trim() !== "" && !/^\s+#/.test(rest))
      ? text
      : text.slice(0, end + 1);
  }
  return text.replace(/\s+#.*$/, "").trim();
}

/** Where the quote opened at the start of `text` closes, or -1. */
function closingQuote(text: string, quote: string): number {
  for (let at = 1; at < text.length; at++) {
    if (quote === '"' && text[at] === "\\") {
      at++;
    } else if (text[at] === quote) {
      if (quote === "'" && text[at + 1] === "'") {
        at++;
      } else {
        return at;
      }
    }
  }
  return -1;
}

function scanEntries(body: string): { entries: Entry[]; isClean: boolean } {
  const entries: Entry[] = [];
  let isClean = true;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const item = LIST_ITEM.exec(line);
    const current = entries.at(-1);
    if (item && current) {
      current.items.push(stripComment(item[1] ?? ""));
    } else if (/^[ \t]/.test(line) && current) {
      current.isNested = true;
    } else {
      const entry = /^[ \t]/.test(line) ? undefined : entryOf(line);
      isClean &&= entry !== undefined;
      entries.push(
        entry ?? { key: line.trim(), rest: "", items: [], isNested: true },
      );
    }
  }
  return { entries, isClean };
}

/** The value of a quoted scalar, or UNREADABLE (escapes, a stray tail). */
function quotedScalar(text: string): Scalar {
  const quote = text[0]!;
  const end = closingQuote(text, quote);
  if (end !== text.length - 1 || (quote === '"' && text.includes("\\"))) {
    return UNREADABLE;
  }
  const inner = text.slice(1, end);
  return quote === "'" ? inner.replaceAll("''", "'") : inner;
}

/** YAML 1.2's core schema, which the sheet's parser uses, for a plain scalar. */
function plainScalar(text: string): Scalar {
  if (/:(?:\s|$)/.test(text) || INDICATOR_START.test(text)) {
    return UNREADABLE;
  }
  if (/^(?:null|Null|NULL|~)$/.test(text)) {
    return null;
  }
  if (/^(?:true|True|TRUE)$/.test(text)) {
    return true;
  }
  if (/^(?:false|False|FALSE)$/.test(text)) {
    return false;
  }
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) {
    const number = Number(text);
    return Number.isSafeInteger(number) || !Number.isInteger(number)
      ? number
      : UNREADABLE;
  }
  return /^(?:0x|0o|[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN))/.test(text)
    ? UNREADABLE
    : text;
}

function scalar(text: string): Scalar {
  if (text === "") {
    return null;
  }
  return /^["']/.test(text) ? quotedScalar(text) : plainScalar(text);
}

/** The parts of a flow list's inside, split at the commas outside quotes. */
function flowParts(inner: string): string[] | undefined {
  const parts: string[] = [];
  let from = 0;
  for (let at = 0; at < inner.length; at++) {
    const quote = /["']/.test(inner[at]!) ? inner[at]! : undefined;
    if (quote && /^\s*$/.test(inner.slice(from, at))) {
      const end = closingQuote(inner.slice(at), quote);
      if (end < 0) {
        return undefined;
      }
      at += end;
    } else if (inner[at] === ",") {
      parts.push(inner.slice(from, at));
      from = at + 1;
    }
  }
  parts.push(inner.slice(from));
  return parts;
}

/** `[a, "b", c]`; nested collections are not read. */
function flowList(text: string): Scalar[] | undefined {
  if (!text.startsWith("[") || !text.endsWith("]")) {
    return undefined;
  }
  const inner = text.slice(1, -1);
  const parts = /[[\]{}]/.test(inner) ? undefined : flowParts(inner);
  if (!parts) {
    return [UNREADABLE];
  }
  return inner.trim() ? parts.map((part) => scalar(part.trim())) : [];
}

const isReadable = (
  value: Scalar,
): value is Exclude<Scalar, typeof UNREADABLE> => value !== UNREADABLE;

function isDate(text: string): boolean {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!day) {
    return false;
  }
  const date = new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().startsWith(day[0]) &&
    /^(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/.test(text.slice(10))
  );
}

function listValue(
  kind: "list" | "tags" | "aliases",
  values: Scalar[],
): SkeletonValue | undefined {
  const items = values.filter(isReadable);
  if (items.length !== values.length || items.some((item) => item === null)) {
    return undefined;
  }
  return { type: "list", kind, items: items.map(String) };
}

const WIKILINK = /^\[\[([^[\]\n]+)\]\]$/;

function scalarValue(
  key: string,
  value: Exclude<Scalar, typeof UNREADABLE>,
): SkeletonValue | undefined {
  const kind: PropertyKind = inferPropertyKind(key, value ?? "");
  if (kind === "list" || kind === "tags" || kind === "aliases") {
    return listValue(kind, value === null ? [] : [value]);
  }
  if (typeof value === "boolean") {
    return { type: "checkbox", checked: value };
  }
  if (typeof value === "number") {
    return { type: "number", text: String(value) };
  }
  const text = value ?? "";
  if (kind === "date" || kind === "datetime") {
    return isDate(text) ? { type: kind, text } : undefined;
  }
  if (text.startsWith("[[")) {
    const link = WIKILINK.exec(text);
    return link
      ? { type: "link", label: wikiTarget(link[1]!).label }
      : undefined;
  }
  return { type: "text", text };
}

/** Lists longer than this are not drawn: the first HTML must stay small. */
const MAX_ITEMS = 50;

function listKind(key: string): "list" | "tags" | "aliases" {
  const kind = inferPropertyKind(key, []);
  return kind === "tags" || kind === "aliases" ? kind : "list";
}

/** The value an entry's lines give, or undefined when the scan cannot say. */
function entryValue(entry: Entry): SkeletonValue | undefined {
  if (entry.isNested || (entry.items.length > 0 && entry.rest !== "")) {
    return undefined;
  }
  const flow = flowList(entry.rest);
  const items = flow ?? entry.items.map(scalar);
  if (items.length > MAX_ITEMS) {
    return undefined;
  }
  if (flow || entry.items.length > 0) {
    return listValue(listKind(entry.key), items);
  }
  const value = scalar(entry.rest);
  return isReadable(value) ? scalarValue(entry.key, value) : undefined;
}

/** Sheets with more rows draw the first ones only, and are inexact. */
const MAX_ROWS = 40;

/** The sheet's rows from a frontmatter body, and whether they are exact. */
export function skeletonSheet(body: string): SkeletonSheet {
  const { entries, isClean } = scanEntries(body);
  const keys = new Set<string>();
  let isExact = isClean && entries.length > 0 && entries.length <= MAX_ROWS;
  const rows = entries.slice(0, MAX_ROWS).map((entry): SkeletonRow => {
    const value = entryValue(entry);
    const isKnown = value !== undefined && !/^["'?&*!|>%@`{[]/.test(entry.key);
    isExact &&= isKnown && !keys.has(entry.key);
    keys.add(entry.key);
    return {
      key: entry.key,
      value: value ?? { type: "opaque", text: entry.rest },
    };
  });
  return { rows, isExact };
}

/** Lucide's chevron and plus, as the sheet draws them (webview/ui/icons.ts). */
const svg = (name: string, shapes: string) =>
  `<svg${name} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="property-icon" aria-hidden="true">${shapes}</svg>`;
export const SKELETON_CHEVRON = svg("", '<path d="m9 18 6-6-6-6"/>');
export const SKELETON_PLUS = svg(
  ' data-lucide="plus"',
  '<path d="M5 12h14"/><path d="M12 5v14"/>',
);

function chip(text: string, kind: "list" | "tags" | "aliases"): string {
  const label = kind === "tags" ? text.replace(/^#/, "") : text;
  const link = WIKILINK.exec(label);
  let content = `<span>${escape(label)}</span>`;
  if (link) {
    content = `<span class="metadata-link"><a class="internal-link">${escape(wikiTarget(link[1]!).label)}</a></span>`;
  } else if (kind === "tags" && validTag(label)) {
    content = `<button type="button" tabindex="-1" class="md-tag">${escape(label)}</button>`;
  }
  return `<span class="property-chip multi-select-pill"><span class="multi-select-pill-content">${content}</span><span class="multi-select-pill-remove-button">×</span></span>`;
}

const field = (type: string, extra: string) =>
  `<input type="${type}" class="metadata-input-${type === "datetime-local" ? "datetime" : type}" data-property-input="" tabindex="-1" readonly ${extra}>`;

function valueMarkup(value: SkeletonValue): string {
  switch (value.type) {
    case "text":
      return `<div class="metadata-input-longtext"${value.text ? "" : ` data-placeholder="${escape(t("Empty"))}"`}>${escape(value.text)}</div>`;
    case "link":
      return `<span class="metadata-link"><a class="internal-link">${escape(value.label)}</a></span>`;
    case "number":
      return field(
        "number",
        `inputmode="decimal" step="any" value="${value.text}"`,
      );
    case "date":
      return field("date", `value="${escape(value.text)}"`);
    case "datetime":
      return field("datetime-local", `value="${escape(value.text)}"`);
    case "checkbox":
      return `<input type="checkbox" class="metadata-input-checkbox" tabindex="-1" disabled${value.checked ? " checked" : ""}>`;
    case "list": {
      const empty = value.items.length
        ? ""
        : ` data-placeholder="${escape(t("Empty"))}"`;
      return `<div class="property-list multi-select-container">${value.items.map((item) => chip(item, value.kind)).join("")}<div class="multi-select-input"${empty}></div></div>`;
    }
    case "opaque":
      return `<div class="mw-skeleton-opaque">${escape(value.text)}</div>`;
  }
}

const rowMarkup = (row: SkeletonRow) =>
  `<div class="property-row metadata-property"><div class="metadata-property-key"><span class="metadata-property-icon"><span class="property-icon"></span></span><span class="property-key metadata-property-key-input">${escape(row.key)}</span></div><div class="metadata-property-value">${valueMarkup(row.value)}</div></div>`;

/** The sheet's own structure and classes, inert: no handlers, no focus. */
export function skeletonMarkup(sheet: SkeletonSheet): string {
  return (
    '<div class="properties metadata-container mw-properties-skeleton">' +
    '<div class="metadata-properties-heading">' +
    `<span class="metadata-collapse-indicator collapse-indicator collapse-icon">${SKELETON_CHEVRON}</span>` +
    `<span class="metadata-properties-title">${escape(t("Properties"))}</span></div>` +
    '<div class="metadata-content"><div class="metadata-properties">' +
    sheet.rows.map(rowMarkup).join("") +
    `</div><span class="metadata-add-button text-icon-button">${SKELETON_PLUS} ${escape(t("Add property"))}</span></div></div>`
  );
}
