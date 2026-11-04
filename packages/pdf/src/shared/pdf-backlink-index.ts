/**
 * Derived in-memory index of PDF deep links found in vault Markdown.
 * Source of truth is the notes; this cache is never written to disk.
 */
import type { ViewRect } from "./geometry";
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

/** Markdown `[label](target)` / `[label](<target>)` destinations. */
const MD_LINK =
  /\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))\s*(?:["'][^"']*["'])?\s*\)/gu;

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
  MD_LINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MD_LINK.exec(noteText)) !== null) {
    const target = (match[2] ?? match[3] ?? "").trim();
    if (!target) {
      continue;
    }
    const hash = target.indexOf("#");
    const pathPart = hash >= 0 ? target.slice(0, hash) : target;
    const fragment = hash >= 0 ? target.slice(hash + 1) : "";
    if (!/\.pdf$/iu.test(pathPart)) {
      continue;
    }
    const pdfKey = normalizePdfKey(
      resolveNoteRelativePdfPath(pathPart, notePath),
    );
    if (!pdfKey) {
      continue;
    }
    const parsed = fragment
      ? parsePdfDeepLinkFragment(fragment)
      : ({} as ReturnType<typeof parsePdfDeepLinkFragment>);
    if (!parsed.page && !parsed.highlightId) {
      continue;
    }
    const hit: PdfBacklinkHit = {
      noteUri,
      notePath,
      linkOffset: match.index,
      pdfKey,
      page: parsed.page ?? 1,
    };
    if (parsed.textFragment) {
      hit.textFragment = { textStart: parsed.textFragment.textStart };
    }
    if (parsed.viewRect) {
      hit.viewRect = parsed.viewRect;
    }
    if (parsed.highlightId) {
      hit.highlightId = parsed.highlightId;
    }
    hits.push(hit);
  }
  return hits;
}


/**
 * When the Markdown target is note-relative (`./`, `../`, or a bare filename),
 * join it with the note's directory and collapse `.` / `..` so the key matches
 * workspace-relative `displayPath`. Vault-root / Copy-link paths
 * (`papers/a.pdf`) are returned unchanged for `normalizePdfKey`.
 */
function resolveNoteRelativePdfPath(pathPart: string, notePath: string): string {
  let value = pathPart.trim().replaceAll("\\", "/");
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep undecoded
  }
  if (value.startsWith("file:")) {
    return pathPart;
  }
  const isNoteRelative =
    value.startsWith("./") ||
    value.startsWith("../") ||
    !value.includes("/");
  if (!isNoteRelative) {
    return pathPart;
  }
  const noteDir = dirnameWorkspacePath(notePath);
  return collapseWorkspacePath(
    noteDir ? `${noteDir}/${value}` : value,
  );
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

/** Workspace-relative PDF path: `/` separators, decode once. */
export function normalizePdfKey(raw: string): string {
  let value = raw.trim().replaceAll("\\", "/");
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep undecoded
  }
  value = value.replace(/^\.\//u, "");
  if (value.startsWith("file:")) {
    try {
      const path = new URL(value).pathname;
      value = decodeURIComponent(path).replace(/^\/+/u, "");
    } catch {
      value = value.replace(/^file:\/\//u, "").replace(/^\/+/u, "");
    }
  }
  return value;
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
  const hit: PdfBacklinkHit = {
    noteUri: fields.noteUri,
    notePath: fields.notePath,
    linkOffset: fields.linkOffset,
    pdfKey: fields.pdfKey,
    page: fields.page,
  };
  const textFragment = fields.textFragment;
  if (textFragment !== undefined) {
    if (
      typeof textFragment !== "object" ||
      textFragment === null ||
      !isBoundedString((textFragment as { textStart?: unknown }).textStart)
    ) {
      return undefined;
    }
    hit.textFragment = {
      textStart: (textFragment as { textStart: string }).textStart,
    };
  }
  if (fields.viewRect !== undefined) {
    const viewRect = parseViewRectField(fields.viewRect);
    if (!viewRect) {
      return undefined;
    }
    hit.viewRect = viewRect;
  }
  if (fields.highlightId !== undefined) {
    if (!isBoundedString(fields.highlightId)) {
      return undefined;
    }
    hit.highlightId = fields.highlightId;
  }
  return hit;
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
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING;
}
