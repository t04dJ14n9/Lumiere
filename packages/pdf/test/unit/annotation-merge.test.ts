import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationEntries,
  mergeAnnotationFile,
} from "../../src/shared/annotation-merge";
import {
  parseAnnotations,
  serializeAnnotations,
} from "../../src/shared/annotation-store";
import { bundle, refOn } from "./support/bundle";

type Row = Parameters<typeof bundle>[0][number];

/** A file of these annotations, as a viewer's save sends it. */
const file = (...rows: Row[]): string | undefined =>
  serializeAnnotations(bundle(rows));

/** The `/NM`s a file holds, with each one's contents. */
async function names(text: string | undefined): Promise<string[]> {
  if (text === undefined) {
    return [];
  }
  const stored = (await parseAnnotations(text))!;
  return stored.bundle.items.map(
    (item) =>
      `${String((item.data as { nm?: string }).nm)}=${String((item.data as { contents?: string }).contents ?? "")}`,
  );
}

// Each pane's engine numbers new annotations itself: both call theirs 40.
const A = { ref: refOn(40), nm: "uuid-a", contents: "A" };
const B = { ref: refOn(40), nm: "uuid-b", contents: "B" };

test("A made in pane 1, then B in pane 2: the file keeps both", async () => {
  const afterPane1 = mergeAnnotationFile(undefined, undefined, file(A));
  const afterPane2 = mergeAnnotationFile(afterPane1, undefined, file(B));
  assert.deepEqual((await names(afterPane2)).sort(), ["uuid-a=A", "uuid-b=B"]);
  const stored = (await parseAnnotations(afterPane2!))!;
  const refs = stored.bundle.items.map((item) => JSON.stringify(item.data.ref));
  assert.equal(new Set(refs).size, 2, "the two keep different refs");
});

test("pane 2 makes and deletes a mark: the file keeps A", async () => {
  const withA = mergeAnnotationFile(undefined, undefined, file(A));
  const withB = mergeAnnotationFile(withA, undefined, file(B));
  // Pane 2 last had B from its own save; it deletes it and has none left.
  const afterDelete = mergeAnnotationFile(withB, file(B), undefined);
  assert.deepEqual(await names(afterDelete), ["uuid-a=A"]);
});

test("a delete in one pane removes only that annotation", async () => {
  const both = mergeAnnotationFile(
    file(A),
    file(A),
    file(A, { ...B, ref: refOn(41) }),
  );
  // Pane 1 loaded A and B; it deletes A.
  const after = mergeAnnotationFile(both, both, file({ ...B, ref: refOn(41) }));
  assert.deepEqual(await names(after), ["uuid-b=B"]);
});

test("a pane that still shows a mark deleted elsewhere does not bring it back", async () => {
  // Both panes loaded A; pane 1 deleted it, so the file has none.
  const pane2Adds = mergeAnnotationFile(
    undefined,
    file(A),
    file(A, { ...B, ref: refOn(41) }),
  );
  assert.deepEqual(await names(pane2Adds), ["uuid-b=B"]);
});

test("a change in one pane is not undone by another pane's unrelated save", async () => {
  const changed = { ...A, contents: "A2" };
  // Pane 1 changed A; pane 2, which still shows A as loaded, adds B.
  const after = mergeAnnotationFile(
    file(changed),
    file(A),
    file(A, { ...B, ref: refOn(41) }),
  );
  assert.deepEqual((await names(after)).sort(), ["uuid-a=A2", "uuid-b=B"]);
});

test("a pane's own change wins over the file's older version", async () => {
  const after = mergeAnnotationFile(
    file(A),
    file(A),
    file({ ...A, contents: "A3" }),
  );
  assert.deepEqual(await names(after), ["uuid-a=A3"]);
});

test("a popup follows its annotation when that annotation's ref changes", async () => {
  const popup = {
    ref: refOn(41),
    subtype: "popup",
    nm: "uuid-b-popup",
    parent: refOn(40),
  };
  const merged = mergeAnnotationFile(file(A), undefined, file(B, popup));
  const stored = (await parseAnnotations(merged!))!;
  const byName = new Map(
    stored.bundle.items.map((item) => [
      (item.data as { nm?: string }).nm,
      item.data as unknown as { ref: unknown; parent?: unknown },
    ]),
  );
  assert.deepEqual(
    byName.get("uuid-b-popup")?.parent,
    byName.get("uuid-b")?.ref,
  );
  assert.notDeepEqual(byName.get("uuid-b")?.ref, byName.get("uuid-a")?.ref);
});

test("drawings go with the stamps that name them", async () => {
  const drawing = new Uint8Array([1, 2, 3]);
  const stamp = { ref: refOn(40), nm: "uuid-s", subtype: "stamp", drawing };
  const merged = mergeAnnotationFile(file(A), undefined, file(stamp));
  const stored = (await parseAnnotations(merged!))!;
  assert.deepEqual(Object.values(stored.bundle.resources), [drawing]);
  const dropped = mergeAnnotationFile(merged, file(stamp), undefined);
  const after = (await parseAnnotations(dropped!))!;
  assert.deepEqual(after.bundle.resources, {});
});

test("a text that is not a version 2 file is written as the viewer sent it", () => {
  assert.equal(mergeAnnotationFile("A", undefined, "B"), "B");
  assert.equal(mergeAnnotationFile(file(A), undefined, "B"), "B");
  const legacy = '{"version":1,"annotations":[]}';
  assert.equal(mergeAnnotationFile(legacy, legacy, file(B)), file(B));
});

test("the annotations of a file are listed by identity, not by ref", () => {
  const one = annotationEntries(file(A));
  const other = annotationEntries(file({ ...A, ref: refOn(77) }));
  assert.deepEqual([...one!.keys()], [...other!.keys()]);
  assert.equal(
    one!.get('nm {"kind":"objectNumber","objectNumber":5} uuid-a')?.content,
    other!.get('nm {"kind":"objectNumber","objectNumber":5} uuid-a')?.content,
  );
  assert.deepEqual(
    other!.get('nm {"kind":"objectNumber","objectNumber":5} uuid-a')?.ref,
    refOn(77),
  );
  assert.equal(annotationEntries("not json"), undefined);
  assert.equal(annotationEntries(undefined)?.size, 0);
});
