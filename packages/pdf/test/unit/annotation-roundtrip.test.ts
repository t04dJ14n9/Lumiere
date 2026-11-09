import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { localEngine } from "@embedpdf/engine";
import { writeAtomicFile } from "../../src/host/atomic-write";
import {
  parseAnnotations,
  serializeAnnotations,
} from "../../src/shared/annotation-store";

const fixturesUrl = pathToFileURL(
  path.join(import.meta.dirname, "../fixtures/make-fixtures.mjs"),
).href;

/** The fixture PDF's bytes: generated/ is gitignored, so each test makes its own. */
async function shortPdf(): Promise<Uint8Array> {
  const fixtures = (await import(fixturesUrl)) as {
    shortPdf: () => Uint8Array;
  };
  return new Uint8Array(fixtures.shortPdf());
}

const line = {
  upperLeft: { x: 72, y: 280 },
  upperRight: { x: 192, y: 280 },
  lowerLeft: { x: 72, y: 298 },
  lowerRight: { x: 192, y: 298 },
};

/** A local engine, as the viewer opens documents, destroyed when the test ends. */
async function withEngine<T>(
  run: (
    open: (
      bytes: Uint8Array,
    ) => ReturnType<ReturnType<typeof localEngine>["open"]>,
  ) => Promise<T>,
): Promise<T> {
  const engine = localEngine();
  try {
    return await run((bytes) =>
      engine.open(
        { kind: "bytes", bytes },
        { identity: { displayName: "Lumia" } },
      ),
    );
  } finally {
    await engine.destroy();
  }
}

test("highlight annotation survives download → atomic write → reopen", async () => {
  const bytes = await shortPdf();
  await withEngine(async (open) => {
    const doc = await open(bytes);
    const [first] = (await doc.pages.list()).pages;
    await doc.page(first!.ref).annotations.create({
      subtype: "highlight",
      quadPoints: [line],
      color: "#FFE600",
      opacity: 0.5,
      blendMode: "multiply",
      contents: "roundtrip",
    });
    const saved = await doc.download();
    await doc.close();

    const dir = await mkdtemp(path.join(tmpdir(), "lumiere-ann-rt-"));
    const target = path.join(dir, "annotated.pdf");
    await writeAtomicFile(target, saved);
    const doc2 = await open(new Uint8Array(await readFile(target)));
    const { annotations } = await doc2.annotations.list();
    const highlight = annotations.find(
      (found) => found.subtype === "highlight",
    );
    assert.equal(highlight?.contents, "roundtrip");
    // The engine keeps colours in lower case.
    assert.equal(highlight?.color, "#ffe600");
    await doc2.close();
  });
});

test("Lumia's annotation file brings a highlight back on the same PDF, once, without touching its bytes", async () => {
  const bytes = await shortPdf();
  await withEngine(async (open) => {
    const doc = await open(bytes);
    const [first] = (await doc.pages.list()).pages;
    await doc.page(first!.ref).annotations.create({
      subtype: "highlight",
      quadPoints: [line],
      color: "#FFE566",
      opacity: 0.3,
      blendMode: "multiply",
      contents: "kept outside",
    });
    const text = serializeAnnotations(await doc.annotations.export())!;
    await doc.close();

    // The next open of the same bytes: the PDF has none, the file has one.
    const reopened = await open(bytes);
    assert.equal((await reopened.annotations.list()).annotations.length, 0);
    const stored = (await parseAnnotations(text))!;
    const result = await reopened.annotations.import(stored.bundle, {
      pages: stored.pages,
    });
    assert.deepEqual(result.dropped, []);
    const { annotations } = await reopened.annotations.list();
    assert.equal(annotations.length, 1);
    const [restored] = annotations;
    assert.equal(restored?.subtype, "highlight");
    assert.equal(restored?.contents, "kept outside");
    assert.equal(restored?.author, "Lumia");
    assert.deepEqual((restored as { quadPoints: unknown }).quadPoints, [line]);

    // Importing again changes nothing: the names are taken.
    const again = await reopened.annotations.import(stored.bundle, {
      pages: stored.pages,
    });
    assert.deepEqual(
      again.dropped.map((drop) => drop.reason),
      ["name-conflict"],
    );
    assert.equal((await reopened.annotations.list()).annotations.length, 1);
    await reopened.close();
  });
});

test("an old version 1 file's annotations come back through the same import", async () => {
  const bytes = await shortPdf();
  const old = JSON.stringify({
    version: 1,
    annotations: [
      {
        annotation: {
          id: "old-1",
          pageIndex: 1,
          type: 9,
          segmentRects: [
            { origin: { x: 72, y: 280 }, size: { width: 120, height: 18 } },
          ],
          strokeColor: "#FFE566",
          color: "#FFE566",
          opacity: 0.3,
          blendMode: 1,
          contents: "from v1",
        },
      },
      {
        annotation: {
          id: "old-2",
          pageIndex: 0,
          type: 5,
          rect: { origin: { x: 10, y: 20 }, size: { width: 80, height: 60 } },
          color: "transparent",
          opacity: 1,
          strokeWidth: 6,
          strokeColor: "#E44234",
          strokeStyle: 1,
        },
      },
    ],
  });
  await withEngine(async (open) => {
    const doc = await open(bytes);
    const stored = (await parseAnnotations(old))!;
    assert.equal(stored.pages, "by-position");
    const result = await doc.annotations.import(stored.bundle, {
      pages: stored.pages,
    });
    assert.deepEqual(result.dropped, []);
    const pages = (await doc.pages.list()).pages;
    const found = (await doc.annotations.list()).annotations.map((one) => ({
      subtype: one.subtype,
      page: pages.findIndex(
        (page) => page.ref.objectNumber === one.page.objectNumber,
      ),
    }));
    assert.deepEqual(
      found.sort((a, b) => a.page - b.page),
      [
        { subtype: "square", page: 0 },
        { subtype: "highlight", page: 1 },
      ],
    );
    await doc.close();
  });
});
