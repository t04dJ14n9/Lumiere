// P26: the file tree draws only the rows in view, whatever the vault's size.
import test from "node:test";
import assert from "node:assert/strict";
import type { FileEntry } from "../../src/shell/api";
import { buildTree } from "../../src/shell/tree";
import {
  ROW_HEIGHT,
  rowWindow,
  scrollToShow,
  visibleRows,
} from "../../src/shell/tree-rows";

const note = (path: string): FileEntry => ({ path, kind: "note" });

test("rows list folders, then files, and what is in the open folders only", () => {
  const root = buildTree(
    ["a/b/deep.md", "a/x.md", "c/y.md", "top.md"].map(note),
  );
  const rows = visibleRows(root, new Set(["a"]));
  assert.deepEqual(
    rows.map((row) => [row.kind, row.path, row.depth]),
    [
      ["folder", "a", 0],
      ["folder", "a/b", 1],
      ["file", "a/x.md", 1],
      ["folder", "c", 0],
      ["file", "top.md", 0],
    ],
  );
  assert.equal(rows[0]?.kind === "folder" && rows[0].isOpen, true);
  assert.equal(rows[1]?.kind === "folder" && rows[1].isOpen, false);
});

test("of 100,000 rows only those in view and a few around them are drawn", () => {
  const count = 100_000;
  const top = rowWindow({ count, scrollTop: 0, viewport: 480 });
  assert.deepEqual(top, { start: 0, end: 480 / ROW_HEIGHT + 10 });
  const middle = rowWindow({
    count,
    scrollTop: 50_000 * ROW_HEIGHT,
    viewport: 480,
  });
  assert.deepEqual(middle, { start: 49_990, end: 50_030 });
  assert.ok(middle.end - middle.start < 50);
  const end = rowWindow({
    count,
    scrollTop: count * ROW_HEIGHT,
    viewport: 480,
  });
  assert.equal(end.end, count);
  // Before the list is measured, a screenful is drawn, not everything.
  assert.ok(rowWindow({ count, scrollTop: 0, viewport: 0 }).end < 100);
});

test("the shown note scrolls into view only when it is out of it", () => {
  const viewport = 10 * ROW_HEIGHT;
  assert.equal(scrollToShow(3, { scrollTop: 0, viewport }), undefined);
  assert.equal(
    scrollToShow(30, { scrollTop: 0, viewport }),
    31 * ROW_HEIGHT - viewport,
  );
  assert.equal(
    scrollToShow(2, { scrollTop: 20 * ROW_HEIGHT, viewport }),
    2 * ROW_HEIGHT,
  );
});
