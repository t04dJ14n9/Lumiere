import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationFolder,
  annotationStoreName,
  inProtectedFolder,
  parseAnnotations,
  serializeAnnotations,
  type StoredAnnotation,
} from "../../src/shared/annotation-store";

const highlight = (id: string, pageIndex: number): StoredAnnotation => ({
  annotation: {
    id,
    pageIndex,
    type: 9,
    rect: { origin: { x: 10, y: 20 }, size: { width: 30, height: 12 } },
    color: "#FFCD45",
    created: new Date("2026-11-08T10:00:00.000Z"),
    modified: new Date("2026-11-08T10:05:00.000Z"),
  },
});

test("annotations round-trip with their dates and a stamp's bytes", () => {
  const stamp: StoredAnnotation = {
    annotation: { id: "s", pageIndex: 0, type: 13 },
    ctx: {
      data: new Uint8Array([0, 1, 254, 255]).buffer,
      mimeType: "image/png",
    },
  };
  const text = serializeAnnotations([highlight("h", 2), stamp])!;
  const items = parseAnnotations(text)!;
  assert.equal(items.length, 2);
  const [first, second] = items;
  assert.equal(first!.annotation.id, "s");
  const ctx = first!.ctx as { data: ArrayBuffer; mimeType: string };
  assert.ok(ctx.data instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(ctx.data)], [0, 1, 254, 255]);
  assert.equal(ctx.mimeType, "image/png");
  assert.ok(second!.annotation.created instanceof Date);
  assert.equal(
    (second!.annotation.modified as Date).toISOString(),
    "2026-11-08T10:05:00.000Z",
  );
  assert.deepEqual(second!.annotation.rect, {
    origin: { x: 10, y: 20 },
    size: { width: 30, height: 12 },
  });
});

test("the file is the same text for the same annotations, whatever their order", () => {
  const a = serializeAnnotations([
    highlight("b", 1),
    highlight("a", 1),
    highlight("c", 0),
  ]);
  const b = serializeAnnotations([
    highlight("c", 0),
    highlight("a", 1),
    highlight("b", 1),
  ]);
  assert.equal(a, b);
  assert.ok(a!.endsWith("}\n"));
});

test("no annotations means no file", () => {
  assert.equal(serializeAnnotations([]), undefined);
});

test("a file that is not an annotation store is rejected, not half-read", () => {
  for (const text of [
    "",
    "not json",
    "[]",
    '{"version":2,"annotations":[]}',
    '{"version":1}',
    '{"version":1,"annotations":[{"annotation":{"id":"x","pageIndex":-1,"type":9}}]}',
    '{"version":1,"annotations":[{"annotation":{"pageIndex":0,"type":9}}]}',
    '{"version":1,"annotations":[{"annotation":{"id":"x","pageIndex":0,"type":9}},5]}',
  ]) {
    assert.equal(parseAnnotations(text), undefined, text);
  }
  assert.deepEqual(parseAnnotations('{"version":1,"annotations":[]}'), []);
});

test("a tag-like object with other keys stays an object", () => {
  const items = parseAnnotations(
    '{"version":1,"annotations":[{"annotation":{"id":"x","pageIndex":0,"type":9,"custom":{"$date":"2026-01-01T00:00:00Z","note":"keep"}}}]}',
  )!;
  assert.deepEqual(items[0]!.annotation.custom, {
    $date: "2026-01-01T00:00:00Z",
    note: "keep",
  });
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
