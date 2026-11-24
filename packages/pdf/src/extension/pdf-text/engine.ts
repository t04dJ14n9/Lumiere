/**
 * The extension host's own PDFium, for reading a PDF's text. It is the same
 * bundle as the outline engine (dist/outline-engine.js, which exports it
 * from there) and is loaded by `PdfTextReader` when an agent first asks for
 * text. The agent bridge reads PDFs that are not open in a viewer, so it
 * cannot ask one.
 */
import {
  createLocalEngine,
  type LocalDocumentHandle,
  type LocalEngine,
  type PageRef,
} from "@embedpdf/engine";
import type { PageRect } from "../../shared/geometry";
import { readBoxesText, type RegionPage } from "../../shared/region-reader";

/** What reading a PDF gives, or why PDFium would not hand its text over. */
export type PdfOpening<T> =
  | { status: "ok"; value: T }
  /** It needs a password, which nothing here can give. */
  | { status: "locked" }
  /** Its permissions forbid taking text out (PDFium refuses `text.get()` then). */
  | { status: "copy-forbidden" };

/** Where on a page a mark's text is: the boxes of its lines. */
export interface QuoteRegion {
  /** 1-based. */
  page: number;
  boxes: readonly PageRect[];
}

export interface PdfTextEngine {
  /**
   * The text of every page, in page order (index 0 is page 1), as PDFium
   * extracts it. Rejects when PDFium cannot open the bytes.
   */
  pages(bytes: Uint8Array): Promise<PdfOpening<string[]>>;
  /** The text under each region, one string per region, in order. */
  quotes(
    bytes: Uint8Array,
    regions: readonly QuoteRegion[],
  ): Promise<PdfOpening<string[]>>;
  dispose(): Promise<void>;
}

/** @param wasm The contents of embedpdf.wasm. */
export function createPdfTextEngine(wasm: Uint8Array): PdfTextEngine {
  // Wasm, never the native addon, for the reasons given in `createOutlineEngine`.
  const engine = createLocalEngine({
    runtime: { prefer: "wasm", wasmBinary: wasm },
  });
  return {
    pages: (bytes) => withDocument(engine, bytes, readPages),
    quotes: (bytes, regions) =>
      withDocument(engine, bytes, (document) => readQuotes(document, regions)),
    async dispose() {
      await engine.destroy();
    },
  };
}

/** Opens the PDF for `read` and closes it again, however `read` ends. */
async function withDocument<T>(
  engine: LocalEngine,
  bytes: Uint8Array,
  read: (document: LocalDocumentHandle) => Promise<T>,
): Promise<PdfOpening<T>> {
  const document = await engine.open({ kind: "bytes", bytes });
  try {
    // A PDF that needs a password opens locked, and everything that reads it
    // then rejects.
    if (document.security.passwordPrompt.state === "required") {
      return { status: "locked" };
    }
    if (!document.security.allows("doc.text.copy")) {
      return { status: "copy-forbidden" };
    }
    return { status: "ok", value: await read(document) };
  } finally {
    await document.close();
  }
}

/** One page at a time: PDFium works on this thread, and the awaits let it breathe. */
async function readPages(document: LocalDocumentHandle): Promise<string[]> {
  const { pages } = await document.pages.list();
  const texts: string[] = [];
  for (const { ref } of pages) {
    texts.push((await document.page(ref).text.get()).text);
  }
  return texts;
}

async function readQuotes(
  document: LocalDocumentHandle,
  regions: readonly QuoteRegion[],
): Promise<string[]> {
  const { pages } = await document.pages.list();
  const quotes: string[] = [];
  // Regions arrive in reading order, so the last page's layout (every glyph
  // box of it) is all that is worth keeping.
  let current: { number: number; page: RegionPage } | undefined;
  for (const { page: number, boxes } of regions) {
    const ref = pages[number - 1]?.ref;
    if (!ref) {
      quotes.push("");
      continue;
    }
    if (current?.number !== number) {
      current = { number, page: regionPageOf(document, ref) };
    }
    quotes.push(await readBoxesText(current.page, boxes));
  }
  return quotes;
}

function regionPageOf(document: LocalDocumentHandle, ref: PageRef): RegionPage {
  const { text } = document.page(ref);
  let layout: ReturnType<typeof text.layout> | undefined;
  return {
    layout: () => (layout ??= text.layout()),
    slice: (range) => text.slice(range),
  };
}
