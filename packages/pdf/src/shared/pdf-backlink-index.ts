/**
 * Derived in-memory index of PDF deep links found in vault Markdown.
 * Source of truth is the notes; this cache is never written to disk.
 */
import type { ViewRect } from "./geometry";
import { readLinkDestination } from "./native-links";
import { parsePdfDeepLinkFragment } from "./text-fragment";

export interface PdfBacklinkHit {
  noteUri: string;
  notePath: string;
  linkOffset: number;
  pdfKey: string;
  page: number;
  textFragment?: { textStart: string };
  viewRect?: ViewRect;
  highlightId?: string;
}

/** The `[label](` that opens an inline link; its destination follows. */
const MD_LINK_START = /\[[^\]]*\]\(\s*/gu;

/**
 * Collect PDF deep-link hits from one note's Markdown text.
 * Non-PDF targets are ignored; legacy `#hl-…` fragments are kept for open.
 */
export function extractPdfBacklinks(
  noteText: string,
  notePath: string,
  noteUri: string,
): PdfBacklinkHit[] {
  const hits: PdfBacklinkHit[] = [];
  for (const match of noteText.matchAll(MD_LINK_START)) {
    const target = destinationAt(noteText, match.index + match[0].length);
    const hit = target
      ? hitFromTarget(target, { linkOffset: match.index, notePath, noteUri })
      : undefined;
    if (hit) {
      hits.push(hit);
    }
  }
  return hits;
}

/**
 * The destination in either CommonMark form: `<papers/my paper.pdf#page=2>`
 * or bare, with balanced parentheses (`papers/a(1).pdf#page=2`). Copy link
 * writes the bare form, percent-encoded. A destination never spans lines.
 */
function destinationAt(text: string, start: number): string | undefined {
  const lineEnd = text.indexOf("\n", start);
  const line = text.slice(start, lineEnd < 0 ? text.length : lineEnd);
  return readLinkDestination(line, 0)?.href.trim();
}

function hitFromTarget(
  target: string,
  source: { linkOffset: number; notePath: string; noteUri: string },
): PdfBacklinkHit | undefined {
  const hash = target.indexOf("#");
  const pathPart = hash >= 0 ? target.slice(0, hash) : target;
  const fragment = hash >= 0 ? target.slice(hash + 1) : "";
  if (!/\.pdf$/iu.test(pathPart)) {
    return undefined;
  }
  const pdfKey = pdfKeyOfLinkPath(pathPart, source.notePath);
  if (!pdfKey) {
    return undefined;
  }
  const parsed = fragment
    ? parsePdfDeepLinkFragment(fragment)
    : ({} as ReturnType<typeof parsePdfDeepLinkFragment>);
  if (!parsed.page && !parsed.highlightId) {
    return undefined;
  }
  return {
    noteUri: source.noteUri,
    notePath: source.notePath,
    linkOffset: source.linkOffset,
    pdfKey,
    page: parsed.page ?? 1,
    ...(parsed.textFragment
      ? { textFragment: { textStart: parsed.textFragment.textStart } }
      : {}),
    ...(parsed.viewRect ? { viewRect: parsed.viewRect } : {}),
    ...(parsed.highlightId ? { highlightId: parsed.highlightId } : {}),
  };
}

/**
 * The workspace-relative key a link's path names. The path is percent-decoded
 * once, here: Copy link encodes `%`, so a second decode would turn a file
 * named `a%20b.pdf` into `a b.pdf`.
 */
function pdfKeyOfLinkPath(pathPart: string, notePath: string): string {
  if (/^file:/iu.test(pathPart)) {
    return fileUrlKey(pathPart);
  }
  return normalizePdfKey(
    resolveNoteRelativePdfPath(decodeLinkPath(pathPart), notePath),
  );
}

function decodeLinkPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    // A stray `%` in a hand-written link is part of the name.
    return path;
  }
}

function fileUrlKey(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\/+/u, "");
  } catch {
    return url.replace(/^file:\/\//iu, "").replace(/^\/+/u, "");
  }
}

/**
 * When the (decoded) Markdown path is note-relative (`./`, `../`, or a bare
 * filename), join it with the note's directory and collapse `.` / `..` so the
 * key matches workspace-relative `displayPath`. Vault-root / Copy-link paths
 * (`papers/a.pdf`) are returned unchanged.
 */
function resolveNoteRelativePdfPath(path: string, notePath: string): string {
  const value = path.trim().replaceAll("\\", "/");
  const isNoteRelative =
    value.startsWith("./") || value.startsWith("../") || !value.includes("/");
  if (!isNoteRelative) {
    return value;
  }
  const noteDir = dirnameWorkspacePath(notePath);
  return collapseWorkspacePath(noteDir ? `${noteDir}/${value}` : value);
}

function dirnameWorkspacePath(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : "";
}

/** Collapse `.` / `..` segments; output uses `/` and has no leading `/`. */
function collapseWorkspacePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (out.length > 0) {
        out.pop();
      }
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * A workspace-relative PDF path as `displayPath` writes it: `/` separators.
 * Never decoded: it is a real path, so a `%` in it is part of the name.
 */
export function normalizePdfKey(raw: string): string {
  return raw.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

/**
 * Per-PDF lookup of backlink hits. `replaceNote` refreshes one note without
 * a full vault rebuild; `lookup` is O(hits for that PDF).
 */
export class PdfBacklinkIndex {
  private readonly byNote = new Map<string, PdfBacklinkHit[]>();
  private readonly byPdf = new Map<string, PdfBacklinkHit[]>();

  replaceNote(noteUri: string, notePath: string, text: string): void {
    this.removeNote(noteUri);
    const hits = extractPdfBacklinks(text, notePath, noteUri);
    if (hits.length === 0) {
      return;
    }
    this.byNote.set(noteUri, hits);
    for (const hit of hits) {
      const list = this.byPdf.get(hit.pdfKey);
      if (list) {
        list.push(hit);
      } else {
        this.byPdf.set(hit.pdfKey, [hit]);
      }
    }
  }

  removeNote(noteUri: string): void {
    const previous = this.byNote.get(noteUri);
    if (!previous) {
      return;
    }
    this.byNote.delete(noteUri);
    for (const hit of previous) {
      const list = this.byPdf.get(hit.pdfKey);
      if (!list) {
        continue;
      }
      const next = list.filter((entry) => entry.noteUri !== noteUri);
      if (next.length === 0) {
        this.byPdf.delete(hit.pdfKey);
      } else {
        this.byPdf.set(hit.pdfKey, next);
      }
    }
  }

  lookup(pdfKey: string): readonly PdfBacklinkHit[] {
    return this.byPdf.get(normalizePdfKey(pdfKey)) ?? [];
  }

  clear(): void {
    this.byNote.clear();
    this.byPdf.clear();
  }
}

const MAX_HITS = 10_000;
const MAX_STRING = 8_192;

/** Validate host→viewer `pdfBacklinks.hits` from an untrusted channel. */
export function parsePdfBacklinkHits(
  value: unknown,
): PdfBacklinkHit[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const hits: PdfBacklinkHit[] = [];
  for (const item of value.slice(0, MAX_HITS)) {
    const hit = parsePdfBacklinkHit(item);
    if (hit) {
      hits.push(hit);
    }
  }
  return hits;
}

function parsePdfBacklinkHit(value: unknown): PdfBacklinkHit | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const fields = value as Record<string, unknown>;
  const required = parseRequiredHitFields(fields);
  if (!required) {
    return undefined;
  }
  const optionals = parseOptionalHitFields(fields);
  return optionals ? { ...required, ...optionals } : undefined;
}

function parseRequiredHitFields(
  fields: Record<string, unknown>,
):
  | Omit<PdfBacklinkHit, "textFragment" | "viewRect" | "highlightId">
  | undefined {
  if (
    !isBoundedString(fields.noteUri) ||
    !isBoundedString(fields.notePath) ||
    !isBoundedString(fields.pdfKey) ||
    typeof fields.linkOffset !== "number" ||
    !Number.isSafeInteger(fields.linkOffset) ||
    fields.linkOffset < 0 ||
    typeof fields.page !== "number" ||
    !Number.isSafeInteger(fields.page) ||
    fields.page < 1
  ) {
    return undefined;
  }
  return {
    noteUri: fields.noteUri,
    notePath: fields.notePath,
    linkOffset: fields.linkOffset,
    pdfKey: fields.pdfKey,
    page: fields.page,
  };
}

function parseOptionalHitFields(
  fields: Record<string, unknown>,
):
  | Pick<PdfBacklinkHit, "textFragment" | "viewRect" | "highlightId">
  | undefined {
  const out: Pick<PdfBacklinkHit, "textFragment" | "viewRect" | "highlightId"> =
    {};
  if (fields.textFragment !== undefined) {
    const textStart = parseTextFragmentStart(fields.textFragment);
    if (textStart === undefined) {
      return undefined;
    }
    out.textFragment = { textStart };
  }
  if (fields.viewRect !== undefined) {
    const viewRect = parseViewRectField(fields.viewRect);
    if (!viewRect) {
      return undefined;
    }
    out.viewRect = viewRect;
  }
  if (fields.highlightId !== undefined) {
    if (!isBoundedString(fields.highlightId)) {
      return undefined;
    }
    out.highlightId = fields.highlightId;
  }
  return out;
}

function parseTextFragmentStart(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const textStart = (value as { textStart?: unknown }).textStart;
  return isBoundedString(textStart) ? textStart : undefined;
}

function parseViewRectField(value: unknown): ViewRect | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { left, top, width, height } = value as Record<string, unknown>;
  if (
    ![left, top, width, height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) ||
    (width as number) <= 0 ||
    (height as number) <= 0
  ) {
    return undefined;
  }
  return {
    left: left as number,
    top: top as number,
    width: width as number,
    height: height as number,
  };
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_STRING
  );
}
