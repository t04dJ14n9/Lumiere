import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationKey } from "@embedpdf/engine-core/public";
import type {
  AnnotationBundle,
  AnnotationCapability,
  AnnotationRef,
} from "@embedpdf/react/annotation";
import { AnnotationOwnership } from "../../src/shared/annotation-ownership";
import {
  parseAnnotations,
  serializeAnnotations,
} from "../../src/shared/annotation-store";
import { showStoreFile } from "../../src/webview/annotation-store-sync";
import { bundle, refOn } from "./support/bundle";

interface Mark {
  nm: string;
  contents: string;
}

const file = (marks: Array<Mark & { number?: number }>) =>
  serializeAnnotations(
    bundle(
      marks.map(({ number, ...mark }, index) => ({
        ref: refOn(number ?? 40 + index),
        ...mark,
      })),
    ),
  );

/**
 * A viewer showing `marks` (all Lumiere's), with the parts of EmbedPDF the
 * sync uses: an import drops a name the page already has, as EmbedPDF does.
 */
function viewer(marks: Mark[]) {
  const present = new Map<number, Mark>();
  const ownership = new AnnotationOwnership();
  let next = 200;
  const add = (mark: Mark): AnnotationRef => {
    const ref = refOn(next++) as AnnotationRef;
    present.set((ref as { objectNumber: number }).objectNumber, mark);
    return ref;
  };
  ownership.imported(marks.map((mark) => annotationKey(add(mark))));
  const annotation = {
    export: async () =>
      bundle(
        [...present].map(([number, mark]) => ({ ref: refOn(number), ...mark })),
      ),
    delete: async (ref: { objectNumber: number }) => {
      present.delete(ref.objectNumber);
    },
    import: async (incoming: AnnotationBundle) => {
      const names = new Set([...present.values()].map((mark) => mark.nm));
      const annotations = incoming.items
        .map((item) => item.data as unknown as Mark)
        .filter((mark) => !names.has(mark.nm))
        .map((mark) => ({
          ref: add({ nm: mark.nm, contents: mark.contents }),
        }));
      return { annotations, refMap: [], dropped: [] };
    },
  } as unknown as AnnotationCapability;
  const shown = () =>
    [...present.values()].map((mark) => `${mark.nm}=${mark.contents}`).sort();
  return { annotation, ownership, shown };
}

const A: Mark = { nm: "uuid-a", contents: "A" };
const B: Mark = { nm: "uuid-b", contents: "B" };

test("a mark another pane made is shown, and kept as Lumiere's", async () => {
  const { annotation, ownership, shown } = viewer([]);
  await showStoreFile(
    annotation,
    ownership,
    { previous: undefined, next: file([A]) },
    "op",
  );
  assert.deepEqual(shown(), ["uuid-a=A"]);
  assert.equal(ownership.keys().length, 1);
});

test("a mark another pane deleted goes; one made here and not yet saved stays", async () => {
  const { annotation, ownership, shown } = viewer([A, B]);
  // This viewer had A from the host; B it made itself.
  await showStoreFile(
    annotation,
    ownership,
    { previous: file([A]), next: undefined },
    "op",
  );
  assert.deepEqual(shown(), ["uuid-b=B"]);
});

test("a mark another pane changed shows the change, unless it was changed here too", async () => {
  const changedThere = { ...A, contents: "A2" };
  const one = viewer([A]);
  await showStoreFile(
    one.annotation,
    one.ownership,
    { previous: file([A]), next: file([changedThere]) },
    "op",
  );
  assert.deepEqual(one.shown(), ["uuid-a=A2"]);

  const two = viewer([{ ...A, contents: "A3" }]);
  await showStoreFile(
    two.annotation,
    two.ownership,
    { previous: file([A]), next: file([changedThere]) },
    "op",
  );
  assert.deepEqual(two.shown(), ["uuid-a=A3"]);
});

test("the sync's fake export matches the file format", async () => {
  // Guards the fake above: what it exports reads back as a store file.
  const { annotation } = viewer([A]);
  const text = serializeAnnotations(await annotation.export())!;
  assert.equal((await parseAnnotations(text))?.bundle.items.length, 1);
});

test("a file in a form this viewer cannot compare is shown and deleted nothing, and is not counted as shown", async () => {
  const one = viewer([A]);
  const result = await showStoreFile(
    one.annotation,
    one.ownership,
    { previous: file([A]), next: '{"version":1,"annotations":[]}' },
    "op",
  );
  assert.equal(result, undefined);
  assert.deepEqual(one.shown(), ["uuid-a=A"]);
});
