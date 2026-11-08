/**
 * Derived in-memory index of PDF deep links found in vault Markdown.
 * Source of truth is the notes; this cache is never written to disk.
 */
import type { ViewRect } from "./geometry";
import { nativeLinkContext } from "./native-link-context";
import { escaped, readLinkDestination } from "./native-links";
import {
  normalizePdfKey,
  pdfKeysOfLinkPath,
  type PdfLinkKeys,
} from "./pdf-backlink-key";
import { parsePdfDeepLinkFragment } from "./text-fragment";

export { normalizePdfKey };

export interface PdfBacklinkHit {
  noteUri: string;
  notePath: string;
  linkOffset: number;
  /** The PDF this link opens, as a path in the note's workspace folder. */
  pdfKey: string;
  page: number;
  textFragment?: { textStart: string };
  viewRect?: ViewRect;
}

/** A hit with the other PDFs its path may name; the viewer never sees `keys`. */
export interface IndexedHit {
  hit: PdfBacklinkHit;
  keys: PdfLinkKeys;
}

/** A PDF: its workspace folder (`""` outside every folder) and its path in it. */
export interface PdfFile {
  folder: string;
  path: string;
}

/** The `[label](` that opens an inline link; its destination follows. */
const MD_LINK_START = /\[[^\]]*\]\(\s*/gu;

/**
 * Collect PDF deep-link hits from one note's Markdown text.
 * Non-PDF targets and links that name no page are ignored.
 */
export function extractPdfBacklinks(
  noteText: string,
  notePath: string,
  noteUri: string,
): PdfBacklinkHit[] {
  return extractIndexedHits(noteText, notePath, noteUri).map(({ hit }) => hit);
}

/**
 * Links in code, HTML comments and HTML blocks are text, not links, as the
 * Markdown editor shows them; so is an escaped `\[`. An embed (`![…](…)`)
 * still points at the page.
 */
export function extractIndexedHits(
  noteText: string,
  notePath: string,
  noteUri: string,
): IndexedHit[] {
  const entries: IndexedHit[] = [];
  const context = nativeLinkContext(noteText);
  for (const match of context.matchAll(MD_LINK_START)) {
    if (escaped(context, match.index)) {
      continue;
    }
    const target = destinationAt(noteText, match.index + match[0].length);
    const entry = target
      ? hitFromTarget(target, { linkOffset: match.index, notePath, noteUri })
      : undefined;
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
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
): IndexedHit | undefined {
  const hash = target.indexOf("#");
  const pathPart = hash >= 0 ? target.slice(0, hash) : target;
  const fragment = hash >= 0 ? target.slice(hash + 1) : "";
  if (!/\.pdf$/iu.test(pathPart)) {
    return undefined;
  }
  const keys = pdfKeysOfLinkPath(pathPart, source.notePath);
  if (!keys) {
    return undefined;
  }
  const parsed = fragment
    ? parsePdfDeepLinkFragment(fragment)
    : ({} as ReturnType<typeof parsePdfDeepLinkFragment>);
  if (!parsed.page) {
    return undefined;
  }
  const hit: PdfBacklinkHit = {
    noteUri: source.noteUri,
    notePath: source.notePath,
    linkOffset: source.linkOffset,
    pdfKey: keys.pdfKey,
    page: parsed.page ?? 1,
    ...(parsed.textFragment
      ? { textFragment: { textStart: parsed.textFragment.textStart } }
      : {}),
    ...(parsed.viewRect ? { viewRect: parsed.viewRect } : {}),
  };
  return { hit, keys };
}

type Table = Map<string, IndexedHit[]>;

/**
 * Two folders of a multi-root workspace can each hold `papers/a.pdf`, so a
 * key means something only inside its workspace folder.
 */
function slot(folder: string, key: string): string {
  return `${folder}\u0000${key}`;
}

function addTo(table: Table, key: string, entry: IndexedHit): void {
  const list = table.get(key);
  if (list) {
    list.push(entry);
  } else {
    table.set(key, [entry]);
  }
}

function removeFrom(table: Table, key: string, noteUri: string): void {
  const next = (table.get(key) ?? []).filter(
    ({ hit }) => hit.noteUri !== noteUri,
  );
  if (next.length === 0) {
    table.delete(key);
  } else {
    table.set(key, next);
  }
}

/** The hit as the looked-up PDF's own key names it. */
function atKey(hit: PdfBacklinkHit, pdfKey: string): PdfBacklinkHit {
  return hit.pdfKey === pdfKey ? hit : { ...hit, pdfKey };
}

/**
 * Per-PDF lookup of backlink hits. `replaceNote` refreshes one note without
 * a full vault rebuild; `lookup` is O(hits for that PDF).
 *
 * A foldered link path (`papers/a.pdf`) opens the vault-root file when there
 * is one, else the one beside the note. Only the file system knows which, so
 * the index keeps the note-relative reading apart (`fallbacks`) and `hitsFor`
 * asks.
 */
export class PdfBacklinkIndex {
  private readonly byNote = new Map<
    string,
    { folder: string; entries: IndexedHit[] }
  >();
  private readonly byPdf: Table = new Map();
  private readonly fallbacks: Table = new Map();

  /** `folder` is the note's workspace folder, any string that names it. */
  replaceNote(
    noteUri: string,
    notePath: string,
    text: string,
    folder = "",
  ): void {
    this.removeNote(noteUri);
    const entries = extractIndexedHits(text, notePath, noteUri);
    if (entries.length === 0) {
      return;
    }
    this.byNote.set(noteUri, { folder, entries });
    for (const entry of entries) {
      const { pdfKey, fallbackKey, externalKey } = entry.keys;
      addTo(this.byPdf, slot(folder, pdfKey), entry);
      if (externalKey) {
        addTo(this.byPdf, slot("", externalKey), entry);
      }
      if (fallbackKey) {
        addTo(this.fallbacks, slot(folder, fallbackKey), entry);
      }
    }
  }

  removeNote(noteUri: string): void {
    const previous = this.byNote.get(noteUri);
    if (!previous) {
      return;
    }
    this.byNote.delete(noteUri);
    const { folder, entries } = previous;
    for (const { keys } of entries) {
      removeFrom(this.byPdf, slot(folder, keys.pdfKey), noteUri);
      if (keys.externalKey) {
        removeFrom(this.byPdf, slot("", keys.externalKey), noteUri);
      }
      if (keys.fallbackKey) {
        removeFrom(this.fallbacks, slot(folder, keys.fallbackKey), noteUri);
      }
    }
  }

  /** Links whose first reading is this PDF; see `hitsFor` for the rest. */
  lookup(pdfKey: string, folder = ""): readonly PdfBacklinkHit[] {
    const key = normalizePdfKey(pdfKey);
    return (this.byPdf.get(slot(folder, key)) ?? []).map(({ hit }) =>
      atKey(hit, key),
    );
  }

  /**
   * Every link that opens this PDF: those that name it first, and the
   * note-relative readings of foldered paths whose vault-root file is not
   * one (`isFile`), as the editor opens them.
   */
  async hitsFor(
    pdf: PdfFile,
    isFile: (file: PdfFile) => Promise<boolean>,
  ): Promise<PdfBacklinkHit[]> {
    const key = normalizePdfKey(pdf.path);
    const direct = this.lookup(key, pdf.folder);
    const candidates = this.fallbacks.get(slot(pdf.folder, key)) ?? [];
    const rootKeys = [...new Set(candidates.map(({ hit }) => hit.pdfKey))];
    const rootIsFile = new Map(
      await Promise.all(
        rootKeys.map(
          async (path) =>
            [path, await isFile({ folder: pdf.folder, path })] as const,
        ),
      ),
    );
    const beside = candidates
      .filter(({ hit }) => !rootIsFile.get(hit.pdfKey))
      .map(({ hit }) => atKey(hit, key));
    return [...direct, ...beside];
  }

  clear(): void {
    this.byNote.clear();
    this.byPdf.clear();
    this.fallbacks.clear();
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
): Omit<PdfBacklinkHit, "textFragment" | "viewRect"> | undefined {
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
): Pick<PdfBacklinkHit, "textFragment" | "viewRect"> | undefined {
  const out: Pick<PdfBacklinkHit, "textFragment" | "viewRect"> = {};
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
