import assert from "node:assert/strict";
import { test } from "node:test";
import { treeKeyAction, type KeyRow } from "../../src/shared/tree-keys";

/** A (open) > a1, a2 (closed, has children); b (closed, has children); c (a leaf). */
const rows: KeyRow[] = [
  { id: "a", depth: 0, expandable: true, expanded: true },
  { id: "a1", depth: 1, parentId: "a", expandable: false, expanded: false },
  { id: "a2", depth: 1, parentId: "a", expandable: true, expanded: false },
  { id: "b", depth: 0, expandable: true, expanded: false },
  { id: "c", depth: 0, expandable: false, expanded: false },
];

const press = (key: string, focused?: string, pageSize = 3) =>
  treeKeyAction(key, rows, focused, pageSize);

test("Up and Down move one row and stop at the ends; the first press picks the first row", () => {
  assert.deepEqual(press("ArrowDown", "a"), { kind: "focus", id: "a1" });
  assert.deepEqual(press("ArrowUp", "a1"), { kind: "focus", id: "a" });
  assert.deepEqual(press("ArrowUp", "a"), { kind: "focus", id: "a" });
  assert.deepEqual(press("ArrowDown", "c"), { kind: "focus", id: "c" });
  assert.deepEqual(press("ArrowDown"), { kind: "focus", id: "a" });
  assert.deepEqual(press("ArrowUp"), { kind: "focus", id: "a" });
});

test("Home and End go to the ends; Page keys go a screenful less one", () => {
  assert.deepEqual(press("Home", "b"), { kind: "focus", id: "a" });
  assert.deepEqual(press("End", "a"), { kind: "focus", id: "c" });
  assert.deepEqual(press("PageDown", "a", 3), { kind: "focus", id: "a2" });
  assert.deepEqual(press("PageUp", "c", 3), { kind: "focus", id: "a2" });
  assert.deepEqual(press("PageDown", "a", 1), { kind: "focus", id: "a1" });
});

test("Right opens a closed branch, then steps into an open one, and does nothing on a leaf", () => {
  assert.deepEqual(press("ArrowRight", "b"), { kind: "expand", id: "b" });
  assert.deepEqual(press("ArrowRight", "a"), { kind: "focus", id: "a1" });
  assert.equal(press("ArrowRight", "c"), undefined);
  // An open branch with nothing shown under it has nowhere to step.
  assert.equal(
    treeKeyAction(
      "ArrowRight",
      [{ id: "x", depth: 0, expandable: true, expanded: true }],
      "x",
      3,
    ),
    undefined,
  );
});

test("Left closes an open branch, then steps out to the parent, and stays at the top", () => {
  assert.deepEqual(press("ArrowLeft", "a"), { kind: "collapse", id: "a" });
  assert.deepEqual(press("ArrowLeft", "a1"), { kind: "focus", id: "a" });
  assert.deepEqual(press("ArrowLeft", "a2"), { kind: "focus", id: "a" });
  assert.equal(press("ArrowLeft", "b"), undefined);
  assert.equal(press("ArrowLeft", "c"), undefined);
});

test("Enter and Space open the focused row; other keys are not the tree's", () => {
  assert.deepEqual(press("Enter", "a2"), { kind: "open", id: "a2" });
  assert.deepEqual(press(" ", "c"), { kind: "open", id: "c" });
  assert.equal(press("Tab", "c"), undefined);
  assert.equal(press("a", "c"), undefined);
  assert.equal(press("Escape", "c"), undefined);
  assert.equal(treeKeyAction("ArrowDown", [], undefined, 3), undefined);
});

test("a row that is no longer there leaves the keys on the first", () => {
  assert.deepEqual(press("Enter", "gone"), { kind: "open", id: "a" });
});
