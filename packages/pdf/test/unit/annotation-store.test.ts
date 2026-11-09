import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANNOTATION_STORE_VERSION,
  annotationFolder,
  annotationStoreName,
  inProtectedFolder,
  keepOwned,
  parseAnnotations,
  serializeAnnotations,
} from "../../src/shared/annotation-store";
import { bundle, refOn } from "./support/bundle";

test("annotations round-trip as a bundle inside a version 2 file, with a stamp's drawing", async () => {
  const drawing = new Uint8Array([0, 1, 254, 255]);
  const kept = bundle([
    { ref: refOn(7), contents: "hello", createdAt: "2026-11-08T10:00:00.000Z" },
    { ref: refOn(8), subtype: "stamp", drawing },
  ]);
  const text = serializeAnnotations(kept)!;
  assert.equal(ANNOTATION_STORE_VERSION, 2);
  assert.equal(JSON.parse(text).version, 2);
  assert.equal(JSON.parse(text).bundle.format, "embedpdf/annotations");
  assert.ok(text.endsWith("}\n"));
  const stored = (await parseAnnotations(text))!;
  assert.equal(stored.pages, "same");
  assert.equal(stored.skipped, 0);
  assert.deepEqual(stored.bundle, kept);
  assert.ok(Object.values(stored.bundle.resources)[0] instanceof Uint8Array);
});

test("the same annotations make the same file", () => {
  const make = () => serializeAnnotations(bundle([{ ref: refOn(7) }]));
  assert.equal(make(), make());
});

test("no annotations means no file", () => {
  assert.equal(serializeAnnotations(bundle([])), undefined);
});

test("a file that is not an annotation store is rejected, not half-read", async () => {
  for (const text of [
    "",
    "not json",
    "[]",
    '{"version":3,"bundle":{}}',
    '{"version":2}',
    '{"version":2,"bundle":[]}',
    '{"version":1}',
    '{"version":1,"annotations":[{"annotation":{"id":"x","pageIndex":-1,"type":9}}]}',
    '{"version":1,"annotations":[{"annotation":{"pageIndex":0,"type":9}}]}',
    '{"version":1,"annotations":[{"annotation":{"id":"x","pageIndex":0,"type":9}},5]}',
  ]) {
    assert.equal(await parseAnnotations(text), undefined, text);
  }
  const empty = await parseAnnotations('{"version":1,"annotations":[]}');
  assert.equal(empty?.bundle.items.length, 0);
});

test("a damaged bundle is an error the viewer can report, not an empty file", async () => {
  const text = serializeAnnotations(
    bundle([{ ref: refOn(8), subtype: "stamp", drawing: new Uint8Array([1]) }]),
  )!;
  const damaged = JSON.parse(text);
  for (const id of Object.keys(damaged.bundle.resources)) {
    damaged.bundle.resources[id] = "AAAA";
  }
  await assert.rejects(parseAnnotations(JSON.stringify(damaged)), /match/u);
  await assert.rejects(
    parseAnnotations('{"version":2,"bundle":{"format":"other"}}'),
  );
});

test("keepOwned keeps Lumiere's annotations, what belongs to them, and only the drawings they name", () => {
  const drawing = new Uint8Array([9, 9]);
  const other = new Uint8Array([8]);
  const all = bundle([
    { ref: refOn(1), subtype: "stamp", drawing },
    { ref: refOn(2), subtype: "stamp", drawing: other },
    { ref: refOn(3) },
    { ref: refOn(4), subtype: "popup", parent: refOn(1) },
    { ref: refOn(5), subtype: "popup", parent: refOn(2) },
  ]);
  const own = new Set([1, 3]);
  const kept = keepOwned(
    all,
    (ref) => ref.kind === "objectNumber" && own.has(ref.objectNumber),
  );
  assert.deepEqual(
    kept.items.map(
      ({ data }) => (data.ref as { objectNumber: number }).objectNumber,
    ),
    [1, 3, 4],
  );
  assert.equal(Object.keys(kept.resources).length, 1);
  assert.deepEqual(Object.values(kept.resources)[0], drawing);
  // What is kept is still a bundle EmbedPDF writes and reads.
  assert.ok(serializeAnnotations(kept));
});

test("annotation files are named by the PDF's SHA-256 and nothing else", () => {
  const sha = "a".repeat(64);
  assert.equal(annotationStoreName(sha), `${sha}.json`);
  for (const bad of ["", "../x", "A".repeat(64), "a".repeat(63)]) {
    assert.throws(() => annotationStoreName(bad));
  }
});

test("protected folders cover the files inside them, not look-alike names", () => {
  const folders = [".raw", "sources/archive/"];
  assert.equal(inProtectedFolder(".raw/captured/paper.pdf", folders), true);
  assert.equal(inProtectedFolder("./.raw/paper.pdf", folders), true);
  assert.equal(inProtectedFolder(".raw\\captured\\paper.pdf", folders), true);
  assert.equal(inProtectedFolder("sources/archive/a.pdf", folders), true);
  assert.equal(inProtectedFolder(".rawer/paper.pdf", folders), false);
  assert.equal(inProtectedFolder("inbox/paper.pdf", folders), false);
  assert.equal(inProtectedFolder("sources/a.pdf", folders), false);
  assert.equal(inProtectedFolder(".raw", folders), false);
  assert.equal(inProtectedFolder("inbox/paper.pdf", [""]), false);
});

test("the annotation folder setting reads as workspace-relative, home or absolute", () => {
  const workspace = (...segments: string[]) => ({
    from: "workspace",
    segments,
  });
  assert.deepEqual(
    annotationFolder(undefined),
    workspace(".lumiere", "pdf-annotations"),
  );
  assert.deepEqual(
    annotationFolder("  "),
    workspace(".lumiere", "pdf-annotations"),
  );
  assert.deepEqual(
    annotationFolder(42),
    workspace(".lumiere", "pdf-annotations"),
  );
  assert.deepEqual(annotationFolder("meta/pdf"), workspace("meta", "pdf"));
  assert.deepEqual(annotationFolder("./meta\\pdf/"), workspace("meta", "pdf"));
  assert.deepEqual(annotationFolder("~/annotations"), {
    from: "home",
    segments: ["annotations"],
  });
  assert.deepEqual(annotationFolder("~"), { from: "home", segments: [] });
  assert.deepEqual(annotationFolder("/srv/annotations"), {
    from: "absolute",
    path: "/srv/annotations",
  });
  assert.deepEqual(annotationFolder("C:\\Notes\\pdf"), {
    from: "absolute",
    path: "C:\\Notes\\pdf",
  });
  // "~name" is a folder called that, not someone's home.
  assert.deepEqual(annotationFolder("~name"), workspace("~name"));
});
