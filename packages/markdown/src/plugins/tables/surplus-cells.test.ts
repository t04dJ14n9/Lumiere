import test from "node:test";
import assert from "node:assert/strict";
import { ChangeSet, Text } from "@codemirror/state";
import {
  insertColumn,
  insertRow,
  parseTable,
  writeCells,
} from "../../markdown/tables/model";
import { operateTable } from "../../markdown/tables/operations";
import { projectedChanges } from "./projection";

// GFM ignores cells past the header's width, but they are still the note's
// text: a rewrite of the table must carry them along, not delete them.
const source = [
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 | keep me |",
  "| x | y |",
].join("\n");

const lines = (text: string) => text.split("\n");

test("editing one cell keeps surplus cells on rows the user never edited", () => {
  const changes = projectedChanges(source, { row: 2, column: 0 }, "edited", 0);
  const result = ChangeSet.of(changes, source.length)
    .apply(Text.of(lines(source)))
    .toString();
  assert.match(lines(result)[2]!, /\| keep me \|$/);
  assert.equal(parseTable(result)!.rows[2]![0]!.text, "edited");
});

test("the surplus stays outside the table's columns", () => {
  const table = parseTable(source)!;
  assert.deepEqual(
    table.rows.map((row) => row.length),
    [2, 2, 2],
  );
});

test("whole-table rewrites keep each row's surplus with that row", () => {
  const table = parseTable(source)!;
  const rewrites = {
    paste: writeCells(
      table,
      { anchor: { row: 2, column: 1 }, head: { row: 2, column: 1 } },
      [["z"]],
    ),
    insertRow: insertRow(table, 2),
    insertColumn: insertColumn(table, 0),
    sort: operateTable(table, {
      type: "sort",
      column: 0,
      direction: "descending",
    }),
    deleteColumn: operateTable(table, {
      type: "delete",
      axis: "column",
      from: 1,
      to: 1,
    }),
  };
  const widths = { insertColumn: 3, deleteColumn: 1 } as Record<string, number>;
  for (const [name, result] of Object.entries(rewrites)) {
    const row = lines(result).find((line) => line.includes("keep"));
    assert.match(row ?? "", /\| 1 .*\| keep me \|$/, name);
    assert.equal(
      parseTable(result)!.alignments.length,
      widths[name] ?? 2,
      name,
    );
  }
});

test("a paste that widens the table moves the surplus past the new columns", () => {
  const table = parseTable(source)!;
  const result = writeCells(
    table,
    { anchor: { row: 0, column: 2 }, head: { row: 0, column: 2 } },
    [["c"]],
  );
  const next = parseTable(result)!;
  assert.equal(next.alignments.length, 3);
  assert.equal(next.rows[1]![2]!.text, "");
  assert.match(lines(result)[2]!, /\| keep me \|$/);
});
