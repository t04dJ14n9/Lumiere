/**
 * The dark page with the real PDFium. `darkenPage` finds pictures by the alpha
 * of the colour-scheme render (src/shared/dark-page.ts), which holds only as
 * long as the engine leaves pictures opaque there and draws everything else in
 * the scheme's near-transparent ink. An EmbedPDF or PDFium update could break
 * that without a fake engine noticing, and bring back labels the colour of
 * their box. This renders figure.pdf as the viewer does, on every check.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-direct-engine";
import { darkenPage, FORCED_PAGE_COLORS } from "../../src/shared/dark-page";
import { PAGE_COLORS_ENGINE_AVAILABLE } from "../../src/shared/page-colors-engine";
import { FIGURE, figurePdf } from "../fixtures/make-fixtures.mjs";
import { darkFigureProblems } from "../support/dark-figure";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wasmPath = path.join(
  root,
  "node_modules/@embedpdf/pdfium/dist/pdfium.wasm",
);

test(
  "PDFium's renders make figure.pdf a readable dark page with its picture as authored",
  { skip: !PAGE_COLORS_ENGINE_AVAILABLE && "the pageColors patch is off" },
  async () => {
    const wasm = readFileSync(wasmPath);
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/wasm");
      response.end(wasm);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as { port: number };
    try {
      const engine = await createPdfiumEngine(
        `http://127.0.0.1:${port}/pdfium.wasm`,
        { fontFallback: null },
      );
      const bytes = figurePdf();
      const document = await engine
        .openDocumentBuffer({
          id: "figure",
          content: bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        })
        .toPromise();
      const page = document.pages[0]!;
      // The viewer's two renders of a dark page (src/webview/dark-render.ts).
      const size = { scaleFactor: 2, dpr: 1 };
      const normal = await engine
        .renderPageRaw(document, page, size)
        .toPromise();
      const forced = await engine
        .renderPageRaw(document, page, {
          ...size,
          pageColors: FORCED_PAGE_COLORS,
        })
        .toPromise();
      await engine.closeDocument(document).toPromise();
      const white = { ...normal, data: Uint8ClampedArray.from(normal.data) };
      darkenPage(normal.data, forced.data);
      assert.deepEqual(darkFigureProblems(normal, white, FIGURE), []);
    } finally {
      server.close();
    }
  },
);
