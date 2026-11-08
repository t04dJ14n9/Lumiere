import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionFromAnnotation } from "../../src/shared/annotation-handoff";

test("embedded annotation region is marked for Delete / Copy gating", () => {
  const region = selectionFromAnnotation({
    pageIndex: 0,
    rect: { origin: { x: 10, y: 20 }, size: { width: 30, height: 12 } },
    text: "Abstract",
  });
  assert.equal(region.mark, true);
});
