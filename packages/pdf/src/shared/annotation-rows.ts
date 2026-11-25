/**
 * The side panel's Annotations list: every mark of the PDF, in reading
 * order, with the icon, colour and note it shows. Pure; the webview reads the
 * marks from EmbedPDF's annotation plugin and the quoted text from the page.
 */
import { t } from "@workshop/l10n";

/**
 * What a mark is called, and the codicon that stands for it. Labels are
 * functions: translated when shown, not when the module loads.
 */
const KINDS: Readonly<Record<string, { label: () => string; icon: string }>> = {
  highlight: { label: () => t("Highlight"), icon: "edit" },
  underline: { label: () => t("Underline"), icon: "text-size" },
  strikeout: { label: () => t("Strikeout"), icon: "strikethrough" },
  squiggly: { label: () => t("Squiggly"), icon: "pulse" },
  text: { label: () => t("Note"), icon: "note" },
  "free-text": { label: () => t("Text"), icon: "symbol-string" },
  ink: { label: () => t("Drawing"), icon: "pencil" },
  line: { label: () => t("Line"), icon: "dash" },
  square: { label: () => t("Rectangle"), icon: "primitive-square" },
  circle: { label: () => t("Ellipse"), icon: "circle-large-outline" },
  polygon: { label: () => t("Polygon"), icon: "symbol-misc" },
  polyline: { label: () => t("Polyline"), icon: "symbol-misc" },
  stamp: { label: () => t("Stamp"), icon: "verified" },
  caret: { label: () => t("Caret"), icon: "triangle-up" },
  "file-attachment": { label: () => t("Attachment"), icon: "attach" },
  redact: { label: () => t("Redaction"), icon: "eye-closed" },
};

/** The marks of a text a reader quotes: the text under them is what they mark. */
const TEXT_MARKS = new Set(["highlight", "underline", "strikeout", "squiggly"]);

/** A mark as the panel needs it, read from EmbedPDF's. */
export interface MarkInput {
  /** Names the mark for the list's rows (`annotationKey`). */
  key: string;
  subtype: string;
  /** 1-based. */
  page: number;
  /** Where the mark's box starts on the page, in points from its top-left. */
  top: number;
  left: number;
  color?: unknown;
  contents?: unknown;
  /** When the mark was made (EmbedPDF's `createdAt`, an ISO date). */
  createdAt?: unknown;
}

export interface AnnotationRow {
  key: string;
  subtype: string;
  label: string;
  icon: string;
  /** A `#rrggbb` colour for the swatch; missing when the mark has none. */
  color?: string;
  page: number;
  top: number;
  left: number;
  /** The mark's note, flattened to one line. */
  note?: string;
  /** Whether the text under the mark is what it quotes. */
  quotesText: boolean;
  /** When the mark was made, as an ISO date; missing when the file does not say. */
  createdAt?: string;
}

/** Whether a mark is the reader's to see: not a link, a popup's anchor, or a form field. */
export function isListedMark(subtype: string): boolean {
  return Object.hasOwn(KINDS, subtype);
}

/** The marks in reading order: page, then down the page, then across it. */
export function annotationRows(marks: readonly MarkInput[]): AnnotationRow[] {
  return marks
    .filter((mark) => isListedMark(mark.subtype))
    .map((mark): AnnotationRow => {
      const kind = KINDS[mark.subtype]!;
      const color = swatchColor(mark.color);
      const note = noteExcerpt(mark.contents);
      const createdAt = isoDate(mark.createdAt);
      return {
        key: mark.key,
        subtype: mark.subtype,
        label: kind.label(),
        icon: kind.icon,
        ...(color ? { color } : {}),
        page: mark.page,
        top: mark.top,
        left: mark.left,
        ...(note ? { note } : {}),
        quotesText: TEXT_MARKS.has(mark.subtype),
        ...(createdAt ? { createdAt } : {}),
      };
    })
    .sort(
      (a, b) =>
        a.page - b.page ||
        a.top - b.top ||
        a.left - b.left ||
        compare(a.key, b.key),
    );
}

/** `value` when it is a date a reader can be shown. */
function isoDate(value: unknown): string | undefined {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

/**
 * The row's short date for when a mark was made, in the reader's locale:
 * the time for a mark made today, the day and month this year, the full
 * date before that.
 */
export function shortCreated(iso: string, now: Date, locale?: string): string {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(locale, { dateStyle: "medium" });
}

/** The tooltip's line for when a mark was made. */
export function createdLine(iso: string, locale?: string): string {
  const when = new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return t("Created {0}", when);
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** A colour a swatch may be filled with: a hex colour, which is all a mark's colour is. */
export function swatchColor(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value)
    ? value
    : undefined;
}

/** `text` on one line, cut at `max` characters with an ellipsis; undefined when blank. */
export function oneLine(text: unknown, max: number): string | undefined {
  if (typeof text !== "string") {
    return undefined;
  }
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat === "") {
    return undefined;
  }
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** How much of a note a row shows. */
const NOTE_EXCERPT = 80;

export function noteExcerpt(contents: unknown): string | undefined {
  return oneLine(contents, NOTE_EXCERPT);
}

/** How much of the quoted text a row shows. */
export const QUOTE_EXCERPT = 120;

/**
 * What the row's tooltip says: the kind and page, when it was made, the
 * quote, then the whole note.
 */
export function rowTooltip(
  row: AnnotationRow,
  quote: string | undefined,
  contents: unknown,
  locale?: string,
): string {
  const note = typeof contents === "string" ? contents.trim() : "";
  const created = row.createdAt ? createdLine(row.createdAt, locale) : "";
  return [t("{0}, page {1}", row.label, row.page), created, quote, note]
    .filter((part) => part)
    .join("\n");
}
