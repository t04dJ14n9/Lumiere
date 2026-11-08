/**
 * The extension host's PDFium reads real bookmarks: outline.pdf, whose outline
 * test/fixtures/make-fixtures.mjs describes. The extension loads this engine
 * built as dist/pdf/outline-engine.js; test/vscode/section-links.spec.ts
 * covers that bundle.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createOutlineEngine } from "../../src/extension/outlines/engine";
import { OUTLINE, outlinePdf, shortPdf } from "../fixtures/make-fixtures.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wasm = readFileSync(
  path.join(root, "node_modules/@embedpdf/pdfium/dist/pdfium.wasm"),
);

test("the fixture's nested bookmarks come back flat, in order, with 1-based pages", async () => {
  const engine = await createOutlineEngine(wasm);
  try {
    const flat = (items: typeof OUTLINE, depth = 0): unknown[] =>
      items.flatMap((item) => [
        { title: item.title, page: item.page, depth },
        ...flat(item.children, depth + 1),
      ]);
    assert.deepEqual(await engine.sections(outlinePdf()), flat(OUTLINE));
    // The engine keeps working for the next PDF, with or without bookmarks.
    assert.deepEqual(await engine.sections(shortPdf()), []);
    assert.equal((await engine.sections(outlinePdf())).length, 5);
    await assert.rejects(engine.sections(new Uint8Array([1, 2, 3])));
  } finally {
    await engine.dispose();
  }
});
