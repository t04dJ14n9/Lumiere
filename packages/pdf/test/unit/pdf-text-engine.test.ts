/**
 * The extension host's PDFium reads real page text and the text under marks:
 * outline.pdf, whose pages test/fixtures/make-fixtures.mjs describes (each
 * says "Synthetic page N" and, a line below, "Second line N"). The extension
 * loads this engine from dist/pdf/outline-engine.js, the same bundle as the
 * outline engine.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createPdfTextEngine } from "../../src/extension/outlines/engine";
import { outlinePdf, shortPdf } from "../fixtures/make-fixtures.mjs";
import {
  NO_COPY_PERMISSIONS,
  passwordProtectedPdf,
} from "./support/protected-pdf";

const wasm = readFileSync(
  createRequire(import.meta.url).resolve(
    "@embedpdf/engine-runtime-wasm32/embedpdf.wasm",
  ),
);

/** The first line of page N, 18 points high from 72 across, 100 points down: [left, top, right, bottom]. */
const FIRST_LINE = [60, 80, 230, 106] as const;
/** The second line, 14 points high, 130 points down. */
const SECOND_LINE = [60, 112, 230, 135] as const;

async function withEngine(
  use: (engine: ReturnType<typeof createPdfTextEngine>) => Promise<void>,
) {
  const engine = createPdfTextEngine(wasm);
  try {
    await use(engine);
  } finally {
    await engine.dispose();
  }
}

test("every page's text comes back in page order, lines joined with a line break", async () => {
  await withEngine(async (engine) => {
    const opened = await engine.pages(outlinePdf());
    assert.equal(opened.status, "ok");
    const pages = opened.status === "ok" ? opened.value : [];
    assert.equal(pages.length, 12);
    assert.equal(pages[0], "Synthetic page 1\nSecond line 1");
    assert.equal(pages[11], "Synthetic page 12\nSecond line 12");
    // The engine keeps working for the next PDF.
    assert.deepEqual(await engine.pages(shortPdf()), {
      status: "ok",
      value: ["Short page 1", "Short page 2", "Short page 3"],
    });
  });
});

test("the text under a mark is the characters inside its boxes, one box a line", async () => {
  await withEngine(async (engine) => {
    const quotes = await engine.quotes(outlinePdf(), [
      { page: 1, boxes: [FIRST_LINE] },
      { page: 2, boxes: [FIRST_LINE, SECOND_LINE] },
      // A box over nothing, and a page the PDF does not have.
      { page: 3, boxes: [[0, 300, 50, 350]] },
      { page: 99, boxes: [FIRST_LINE] },
    ]);
    assert.deepEqual(quotes, {
      status: "ok",
      value: ["Synthetic page 1", "Synthetic page 2 Second line 2", "", ""],
    });
    assert.deepEqual(await engine.quotes(outlinePdf(), []), {
      status: "ok",
      value: [],
    });
  });
});

test("a PDF that needs a password, or forbids copying, says so instead of giving text", async () => {
  await withEngine(async (engine) => {
    const locked = passwordProtectedPdf();
    assert.deepEqual(await engine.pages(locked), { status: "locked" });
    assert.deepEqual(await engine.quotes(locked, []), { status: "locked" });
    const noCopy = passwordProtectedPdf({
      password: "",
      permissions: NO_COPY_PERMISSIONS,
    });
    assert.deepEqual(await engine.pages(noCopy), { status: "copy-forbidden" });
    assert.deepEqual(await engine.quotes(noCopy, []), {
      status: "copy-forbidden",
    });
    // The same encryption with every permission is read: its one page has no text.
    assert.deepEqual(
      await engine.pages(passwordProtectedPdf({ password: "" })),
      {
        status: "ok",
        value: [""],
      },
    );
  });
});

test("bytes that are no PDF reject, and the engine reads the next one", async () => {
  await withEngine(async (engine) => {
    await assert.rejects(engine.pages(new Uint8Array([1, 2, 3])));
    await assert.rejects(engine.quotes(new Uint8Array([1, 2, 3]), []));
    assert.equal((await engine.pages(outlinePdf())).status, "ok");
  });
});
