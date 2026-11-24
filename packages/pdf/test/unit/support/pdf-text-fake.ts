/**
 * A PDF text reader over made-up PDFs, for the tools that read through it.
 * A PDF is named by the end of its path (`papers/a.pdf`); its "bytes" are
 * that name, which the fake engine reads back.
 */
import type {
  PdfOpening,
  PdfTextEngine,
  QuoteRegion,
} from "../../../src/extension/pdf-text/engine";
import { PdfTextReader } from "../../../src/extension/pdf-text/reader";

export interface FakePdf {
  /** The text of each page. */
  pages?: string[];
  /** What the engine answers for the marks' regions; default: no text. */
  quotes?: (regions: readonly QuoteRegion[]) => string[];
  /** The engine answers that instead of reading. */
  opening?: "locked" | "copy-forbidden";
}

export function fakeTextReader(pdfs: Record<string, FakePdf> = {}) {
  const calls = { pages: 0, quotes: [] as (readonly QuoteRegion[])[] };
  const named = (uri: string) =>
    Object.keys(pdfs).find((name) =>
      decodeURIComponent(uri).endsWith(`/${name}`),
    );
  const opened = <T>(
    bytes: Uint8Array,
    read: (pdf: FakePdf) => T,
  ): PdfOpening<T> => {
    const pdf = pdfs[new TextDecoder().decode(bytes)]!;
    return pdf.opening
      ? { status: pdf.opening }
      : { status: "ok", value: read(pdf) };
  };
  const engine: PdfTextEngine = {
    async pages(bytes) {
      calls.pages++;
      return opened(bytes, (pdf) => pdf.pages ?? []);
    },
    async quotes(bytes, regions) {
      calls.quotes.push(regions);
      return opened(
        bytes,
        (pdf) => pdf.quotes?.(regions) ?? regions.map(() => ""),
      );
    },
    async dispose() {},
  };
  const reader = new PdfTextReader({
    files: {
      stat: async (uri) => (named(uri) ? { mtime: 1, size: 10 } : undefined),
      read: async (uri) => new TextEncoder().encode(named(uri)),
    },
    engine: async () => engine,
    log: () => {},
  });
  return { reader, calls };
}
