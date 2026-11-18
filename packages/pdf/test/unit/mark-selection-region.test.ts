import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionFromAnnotation } from "../../src/shared/annotation-handoff";
import { parseSelection } from "../../src/shared/selection";

test("embedded annotation region is marked for Delete / Copy gating", () => {
  const region = selectionFromAnnotation({
    pageIndex: 0,
    rect: { origin: { x: 10, y: 20 }, size: { width: 30, height: 12 } },
    text: "Abstract",
  });
  assert.equal(region.mark, true);
});

test("a mark's note is accepted from the viewer only with the mark, and not too long", () => {
  const region = { kind: "region", page: 1, rect: [0, 0, 10, 10] };
  assert.deepEqual(parseSelection({ ...region, mark: true, note: "why" }), {
    ...region,
    mark: true,
    note: "why",
  });
  assert.deepEqual(parseSelection({ ...region, note: "why" }), region);
  // Too long to send: flagged, so Edit Note… does not start from nothing.
  assert.deepEqual(
    parseSelection({ ...region, mark: true, note: "x".repeat(10_001) }),
    { ...region, mark: true, noteTooLong: true },
  );
  assert.deepEqual(
    parseSelection({ ...region, mark: true, noteTooLong: true }),
    { ...region, mark: true, noteTooLong: true },
  );
  assert.deepEqual(parseSelection({ ...region, noteTooLong: true }), region);
  assert.deepEqual(
    selectionFromAnnotation({
      pageIndex: 0,
      rect: { origin: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
      note: "  ",
    }),
    { ...region, mark: true },
  );
});
