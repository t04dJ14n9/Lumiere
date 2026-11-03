import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionFromAnnotation } from "../../src/shared/annotation-handoff";
import { regionOf } from "../../src/shared/sidecar-region";
import { highlightStyleOf } from "../../src/shared/highlight-style";

test("embedded annotation region is marked for Delete / Copy gating", () => {
  const region = selectionFromAnnotation({
    pageIndex: 0,
    rect: { origin: { x: 10, y: 20 }, size: { width: 30, height: 12 } },
    text: "Abstract",
  });
  assert.equal(region.mark, true);
  assert.equal(region.highlightId, undefined);
});

test("sidecar regionOf is marked and carries highlightId", () => {
  const region = regionOf({
    id: "hl-abcd1234",
    page: 1,
    subtype: "highlight",
    color: "#FFE566",
    opacity: 0.3,
    segmentRects: [{ x: 72, y: 88, w: 76, h: 14 }],
    quote: "Synthetic",
    contextBefore: "",
    contextAfter: " page 1",
    created: "2026-11-01T18:00:00.000Z",
    modified: "2026-11-01T18:00:00.000Z",
  });
  assert.equal(region.mark, true);
  assert.equal(region.highlightId, "hl-abcd1234");
});

test("highlightStyleOf falls back to light-paper yellow", () => {
  assert.deepEqual(highlightStyleOf({}), {
    color: "#FFE566",
    opacity: 0.3,
  });
  assert.deepEqual(highlightStyleOf({ color: "#ff6b6b", opacity: 0.5 }), {
    color: "#FF6B6B",
    opacity: 0.5,
  });
});
