import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import { localEngine } from "@embedpdf/engine";
import { serializeAnnotations } from "../../src/shared/annotation-store";
import { createPdfTextEngine } from "../../src/extension/outlines/engine";
import { PdfTextReader } from "../../src/extension/pdf-text/reader";
import { outlinePdf } from "../fixtures/make-fixtures.mjs";
import { callTool, fakeDeps } from "./support/bridge-tools";
import { installWorkspace } from "./support/workspace-fixture";

/**
 * The text tools end to end, with nothing made up but VS Code: the real
 * PdfTextReader and PDFium read outline.pdf from a workspace folder, and a
 * mark file written by the real engine is listed with the text under its marks.
 */

const wasm = readFileSync(
  createRequire(import.meta.url).resolve(
    "@embedpdf/engine-runtime-wasm32/embedpdf.wasm",
  ),
);

const quad = (left: number, top: number, right: number, bottom: number) => ({
  upperLeft: { x: left, y: top },
  upperRight: { x: right, y: top },
  lowerLeft: { x: left, y: bottom },
  lowerRight: { x: right, y: bottom },
});

/** The marks of a viewer session on `bytes`, as it would save them: page 2's first line, then page 1's two lines. */
async function savedMarks(bytes: Uint8Array): Promise<string> {
  const engine = localEngine({ runtime: { prefer: "wasm", wasmBinary: wasm } });
  try {
    const document = await engine.open(
      { kind: "bytes", bytes },
      { identity: { displayName: "Lumiere" } },
    );
    const { pages } = await document.pages.list();
    const mark = (index: number, quadPoints: ReturnType<typeof quad>[]) =>
      document.page(pages[index]!.ref).annotations.create({
        subtype: "highlight",
        quadPoints,
        color: "#FFE566",
        opacity: 0.3,
        blendMode: "multiply",
        contents: `mark on page ${index + 1}`,
      });
    await mark(1, [quad(70, 82, 210, 106)]);
    await mark(0, [quad(70, 82, 210, 106), quad(70, 112, 180, 135)]);
    const text = serializeAnnotations(await document.annotations.export());
    await document.close();
    return text!;
  } finally {
    await engine.destroy();
  }
}

async function setup(t: TestContext) {
  const workspace = await installWorkspace();
  t.after(() => workspace.remove());
  const bytes = new Uint8Array(outlinePdf());
  await writeFile(path.join(workspace.root, "papers", "a.pdf"), bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const sidecar = path.join(
    workspace.root,
    ".lumiere",
    "pdf-annotations",
    `${sha}.json`,
  );
  await mkdir(path.dirname(sidecar), { recursive: true });
  await writeFile(sidecar, await savedMarks(bytes));
  const original = vscode.workspace.fs.readFile;
  vscode.workspace.fs.readFile = (async (uri: vscode.Uri) => {
    try {
      return new Uint8Array(await readFile(uri.fsPath));
    } catch {
      throw vscode.FileSystemError.FileNotFound();
    }
  }) as never;
  t.after(() => {
    vscode.workspace.fs.readFile = original;
  });
  const reader = new PdfTextReader({
    files: {
      stat: async (uri) => {
        const { mtimeMs, size } = await stat(fileURLToPath(uri));
        return { mtime: mtimeMs, size };
      },
      read: (uri) => readFile(fileURLToPath(uri)),
    },
    engine: async () => createPdfTextEngine(wasm),
    log: (message) => assert.fail(message),
  });
  t.after(() => reader.dispose());
  return { deps: fakeDeps({ text: reader }), sha };
}

const json = (answer: { json(): unknown }) =>
  answer.json() as Record<string, unknown>;

test("page text, search and quote location work on a PDF that is not open, with links that name the page", async (t) => {
  const { deps } = await setup(t);
  const text = json(
    await callTool(deps, "get_pdf_page_text", {
      path: "papers/a.pdf",
      firstPage: 1,
      lastPage: 2,
    }),
  );
  assert.deepEqual(text, {
    file: "papers/a.pdf",
    pageCount: 12,
    pages: [
      { page: 1, text: "Synthetic page 1\nSecond line 1" },
      { page: 2, text: "Synthetic page 2\nSecond line 2" },
    ],
    truncated: false,
  });
  const found = json(
    await callTool(deps, "find_in_pdf", {
      path: "papers/a.pdf",
      query: "synthetic   PAGE 1",
    }),
  ) as { count: number; matches: { page: number; link: string }[] };
  // "Synthetic page 1" is also the start of "Synthetic page 10", 11 and 12.
  assert.deepEqual(
    found.matches.map(({ page }) => page),
    [1, 10, 11, 12],
  );
  assert.equal(
    found.matches[0]!.link,
    "papers/a.pdf#page=1#:~:text=Synthetic%20page%201",
  );
  const quote = json(
    await callTool(deps, "locate_pdf_quote", {
      path: "papers/a.pdf",
      quote: "line 9",
      prefix: "Second",
    }),
  );
  assert.deepEqual(quote, {
    file: "papers/a.pdf",
    found: true,
    ambiguous: false,
    count: 1,
    matches: [
      {
        page: 9,
        text: "line 9",
        link: "papers/a.pdf#page=9#:~:text=line%209",
      },
    ],
  });
});

test("the marks of the PDF's file are listed in reading order with the text under them, hashing the PDF that is not open", async (t) => {
  const { deps, sha } = await setup(t);
  const answer = await callTool(deps, "list_pdf_annotations", {
    path: "papers/a.pdf",
  });
  assert.equal(answer.isError, false, answer.text);
  assert.deepEqual(answer.json(), {
    file: "papers/a.pdf",
    sha256: sha,
    count: 2,
    marks: [
      {
        page: 1,
        kind: "highlight",
        color: "#ffe566",
        text: "Synthetic page 1 Second line 1",
        note: "mark on page 1",
        link: "papers/a.pdf#page=1#:~:text=Synthetic%20page%201%20Second%20line%201",
      },
      {
        page: 2,
        kind: "highlight",
        color: "#ffe566",
        text: "Synthetic page 2",
        note: "mark on page 2",
        link: "papers/a.pdf#page=2#:~:text=Synthetic%20page%202",
      },
    ],
  });
});
