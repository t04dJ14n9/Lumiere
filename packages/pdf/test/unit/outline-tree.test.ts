import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutlineItem } from "../../src/shared/messages";
import { findActiveOutlineItem } from "../../src/shared/outline";
import {
  branchIds,
  followedBranches,
  outlineRowIdOf,
  outlineRows,
} from "../../src/shared/outline-tree";

const item = (
  title: string,
  page: number,
  children: OutlineItem[] = [],
  top?: number,
): OutlineItem => ({
  title,
  page,
  ...(top === undefined ? {} : { top }),
  children,
});

const s21 = item("Section 2.1", 9, [], 130);
const s11 = item("Section 1.1", 2);
const s12 = item("Section 1.2", 3, [item("Deep", 4)]);
const one = item("Part One", 1, [s11, s12]);
const two = item("Part Two", 6, [s21]);
const items = [one, two];

test("closed branches show only themselves", () => {
  const rows = outlineRows(items, new Set());
  assert.deepEqual(
    rows.map((row) => [row.id, row.depth, row.expanded]),
    [
      ["0", 0, false],
      ["1", 0, false],
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.expandable),
    [true, true],
  );
});

test("an open branch shows its children under it, one level in, with their places among siblings", () => {
  const rows = outlineRows(items, new Set(["0", "0.1"]));
  assert.deepEqual(
    rows.map((row) => [row.id, row.item.title, row.depth, row.parentId]),
    [
      ["0", "Part One", 0, undefined],
      ["0.0", "Section 1.1", 1, "0"],
      ["0.1", "Section 1.2", 1, "0"],
      ["0.1.0", "Deep", 2, "0.1"],
      ["1", "Part Two", 0, undefined],
    ],
  );
  assert.deepEqual(
    rows.map((row) => [row.position, row.siblings]),
    [
      [1, 2],
      [1, 2],
      [2, 2],
      [1, 1],
      [2, 2],
    ],
  );
});

test("a branch named as open, whose parent is closed, does not show", () => {
  assert.deepEqual(
    outlineRows(items, new Set(["0.1"])).map((row) => row.id),
    ["0", "1"],
  );
});

test("a bookmark with no children is never open", () => {
  const rows = outlineRows(items, new Set(["0.0"]));
  assert.equal(rows.length, 2);
  const flat = outlineRows(items, new Set(["0", "0.0"]));
  assert.equal(flat.find((row) => row.id === "0.0")?.expanded, false);
});

test("a bookmark is found by identity, at any depth", () => {
  assert.equal(outlineRowIdOf(items, one), "0");
  assert.equal(outlineRowIdOf(items, s21), "1.0");
  assert.equal(outlineRowIdOf(items, s12.children[0]), "0.1.0");
  assert.equal(outlineRowIdOf(items, item("Elsewhere", 1)), undefined);
  assert.equal(outlineRowIdOf(items, undefined), undefined);
});

test("Expand All opens every branch and only branches", () => {
  assert.deepEqual([...branchIds(items)].sort(), ["0", "0.1", "1"]);
  assert.deepEqual([...branchIds([s11])], []);
});

test("Follow Cursor opens the bookmark's parents and its own children, and closes every other branch", () => {
  assert.deepEqual([...followedBranches(items, "0.1.0")].sort(), ["0", "0.1"]);
  // Its own sub-bookmarks too, but a leaf opens nothing of its own.
  assert.deepEqual([...followedBranches(items, "0.1")].sort(), ["0", "0.1"]);
  assert.deepEqual([...followedBranches(items, "0.0")], ["0"]);
  assert.deepEqual([...followedBranches(items, "1")], ["1"]);
  assert.deepEqual([...followedBranches(items, undefined)], []);
});

test("following the reading position selects what the Explorer's rule picks", () => {
  const active = findActiveOutlineItem(items, { page: 9, top: 130 });
  const id = outlineRowIdOf(items, active);
  assert.equal(id, "1.0");
  const rows = outlineRows(items, followedBranches(items, id));
  assert.deepEqual(
    rows.map((row) => row.item.title),
    ["Part One", "Part Two", "Section 2.1"],
  );
  assert.equal(rows.find((row) => row.id === id)?.item, s21);
});
