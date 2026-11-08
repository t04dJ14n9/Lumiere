/**
 * The extension host's own PDFium, for reading bookmarks. Built as its own
 * bundle (dist/pdf/outline-engine.js) and loaded by `PdfOutlineReader` when
 * the first outline is asked for, so notes that never link to a PDF section
 * do not pay for the engine.
 */
import { init } from "@embedpdf/pdfium";
import { PdfiumNative } from "@embedpdf/engines/pdfium";
import type { PdfBookmarkObject } from "@embedpdf/models";
import {
  outlineSections,
  type OutlineSection,
} from "../../shared/outline-sections";

export interface OutlineEngine {
  /** The sections of the PDF whose bytes these are; rejects when PDFium cannot open it. */
  sections(bytes: Uint8Array): Promise<OutlineSection[]>;
  dispose(): Promise<void>;
}

/** @param wasm The contents of pdfium.wasm. */
export async function createOutlineEngine(
  wasm: Uint8Array,
): Promise<OutlineEngine> {
  const pdfium = await init({ wasmBinary: wasm });
  const engine = new PdfiumNative(pdfium);
  let opened = 0;
  return {
    async sections(bytes) {
      const content = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const document = await engine
        .openDocumentBuffer({ id: `outline-${opened++}`, content })
        .toPromise();
      try {
        const { bookmarks } = (await engine
          .getBookmarks(document)
          .toPromise()) as { bookmarks: PdfBookmarkObject[] };
        return outlineSections(bookmarks);
      } finally {
        await engine.closeDocument(document).toPromise();
      }
    },
    async dispose() {
      await engine.destroy().toPromise();
    },
  };
}
