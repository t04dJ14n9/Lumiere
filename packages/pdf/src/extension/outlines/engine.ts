/**
 * The extension host's own PDFium, for reading bookmarks and, through
 * `createPdfTextEngine`, a PDF's text for the agent bridge. Built as its own
 * bundle (dist/outline-engine.js; the name predates the text reader) and
 * loaded by `PdfOutlineReader` when the first outline is asked for, and by
 * `PdfTextReader` when an agent first asks for text, so notes that never link
 * to a PDF section and sessions with no agent do not pay for the engine.
 */
import { createLocalEngine } from "@embedpdf/engine";
import type { OutlineSection } from "../../shared/outline-sections";
import { sectionsOfOutline } from "./outline-items";

export { createPdfTextEngine } from "../pdf-text/engine";
export type {
  PdfOpening,
  PdfTextEngine,
  QuoteRegion,
} from "../pdf-text/engine";

export interface OutlineEngine {
  /** The sections of the PDF whose bytes these are; rejects when PDFium cannot open it. */
  sections(bytes: Uint8Array): Promise<OutlineSection[]>;
  dispose(): Promise<void>;
}

/** @param wasm The contents of embedpdf.wasm. */
export async function createOutlineEngine(
  wasm: Uint8Array,
): Promise<OutlineEngine> {
  // Wasm, never the native addon the runtime would prefer in Node: the addon
  // is a per-platform package that one VSIX cannot carry, and esbuild cannot
  // bundle a `.node` file. The engine runs in this thread and boots on the
  // first open.
  const engine = createLocalEngine({
    runtime: { prefer: "wasm", wasmBinary: wasm },
  });
  return {
    async sections(bytes) {
      const document = await engine.open({ kind: "bytes", bytes });
      try {
        // A PDF that needs a password opens locked, and everything that
        // reads it then rejects; the reader treats it as having no sections.
        if (document.security.passwordPrompt.state === "required") {
          return [];
        }
        const [{ pages }, { items }] = await Promise.all([
          document.pages.list(),
          document.outline.get(),
        ]);
        return sectionsOfOutline(items, pages);
      } finally {
        await document.close();
      }
    },
    async dispose() {
      await engine.destroy();
    },
  };
}
