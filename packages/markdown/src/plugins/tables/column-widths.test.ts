import test from "node:test";
import assert from "node:assert/strict";
import {
  applyColumnWidth,
  columnEdgeAt,
  indentRows,
  remapColumnWidths,
  rowPrefix,
  widthsAfterOperation,
} from "./column-widths";
import type { TableOperation } from "../../markdown/tables/operations";

const table = "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |";

test("applyColumnWidth updates one column and clamps to a minimum", () => {
  assert.deepEqual(applyColumnWidth([100, 100, 100], 1, 140), [100, 140, 100]);
  assert.deepEqual(applyColumnWidth([100, 100, 100], 0, 10), [60, 100, 100]);
});

test("remapColumnWidths follows insert, delete, move and duplicate of columns", () => {
  const widths = [10, 20, 30, 40];
  assert.deepEqual(remapColumnWidths(widths, { type: "insert", index: 1 }), [
    10,
    undefined,
    20,
    30,
    40,
  ]);
  assert.deepEqual(
    remapColumnWidths(widths, { type: "delete", from: 1, to: 2 }),
    [10, 40],
  );
  assert.deepEqual(
    remapColumnWidths(widths, {
      type: "move",
      from: 0,
      to: 0,
      destination: 2,
    }),
    [20, 30, 10, 40],
  );
  assert.deepEqual(
    remapColumnWidths(widths, { type: "duplicate", from: 1, to: 1 }),
    [10, 20, 20, 30, 40],
  );
  assert.equal(
    remapColumnWidths(undefined, { type: "insert", index: 0 }),
    undefined,
  );
});

test("widthsAfterOperation remaps widths when a column is deleted", () => {
  const op: TableOperation = {
    type: "delete",
    axis: "column",
    from: 0,
    to: 0,
  };
  assert.deepEqual(widthsAfterOperation([100, 200], op), [200]);
  assert.equal(widthsAfterOperation(undefined, op), undefined);
});

test("columnEdgeAt finds the column whose right border the pointer is on", () => {
  const rights = [100, 160, 400];
  assert.equal(columnEdgeAt(rights, 100), 0);
  assert.equal(columnEdgeAt(rights, 98), 0, "2 px inside");
  assert.equal(columnEdgeAt(rights, 102), 0, "2 px outside");
  assert.equal(columnEdgeAt(rights, 97), undefined, "the cell's padding");
  assert.equal(columnEdgeAt(rights, 103), undefined, "the next cell's");
  assert.equal(columnEdgeAt(rights, 130), undefined, "mid-cell");
  assert.equal(columnEdgeAt(rights, 401), 2, "the last border too");
  assert.equal(columnEdgeAt([100, 103], 102), 1, "the nearer of two");
  assert.equal(columnEdgeAt([], 0), undefined);
});

test("rows of a table in a list item keep its indent", () => {
  const listed = "| a | b |\n  | - | - |\n  | 1 | 2 |";
  assert.equal(rowPrefix(listed), "  ");
  assert.equal(rowPrefix("| a |\n\t| - |\n\t| 1 |"), "\t");
  assert.equal(rowPrefix(table), "");
  assert.equal(indentRows("| a | b |\n| - | - |\n| 1 | 2 |", "  "), listed);
  assert.equal(indentRows(table, ""), table);
});
