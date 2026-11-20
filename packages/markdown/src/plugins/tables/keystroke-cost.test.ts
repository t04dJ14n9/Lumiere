import test from "node:test";
import assert from "node:assert/strict";
import { ChangeSet, Text } from "@codemirror/state";
import {
  cellText,
  parseTable,
  serializeTable,
} from "../../markdown/tables/model";
import { parsedTable } from "../../markdown/tables/parsed";
import { projectedChanges } from "./projection";

function largeTable(rows: number, columns: number): string {
  return serializeTable(
    Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => `cell ${row}-${column}`),
    ),
    Array<null>(columns).fill(null),
  );
}

test("a cell keystroke reads each table source once, whoever asks", () => {
  const source = largeTable(50, 4);
  const first = parsedTable(source);
  assert.deepEqual(first, parseTable(source));
  // Live Preview's match slices its own copy of the same text.
  assert.equal(parsedTable(source.slice(0)), first);
  for (let index = 0; index < 4; index++) {
    parsedTable(`${source}\n| ${index} |`);
  }
  // Only the last few sources are kept.
  assert.notEqual(parsedTable(source), first);
  assert.equal(parsedTable("not a table"), undefined);
});

test("typing in one cell of a large table rewrites only its row", () => {
  const source = largeTable(200, 6);
  const changes = projectedChanges(
    source,
    { row: 120, column: 2 },
    "cell 12-x",
    0,
  );
  const lines = source.split("\n");
  // The table's row 120 is source line 121, after the delimiter row.
  const rowFrom = lines.slice(0, 121).join("\n").length + 1;
  const rowTo = rowFrom + lines[121]!.length;
  assert.ok(changes.length > 0);
  for (const change of changes) {
    assert.ok(change.from >= rowFrom && change.to <= rowTo, String(change));
  }
  const next = ChangeSet.of(changes, source.length)
    .apply(Text.of(lines))
    .toString();
  assert.equal(parseTable(next)!.rows[120]![2]!.text, "cell 12-x");
});

test("cell text without pipes or line breaks is written as it is", () => {
  assert.equal(cellText("plain `code` *text*"), "plain `code` *text*");
  assert.equal(cellText("a|b\\|c"), "a\\|b\\|c");
  assert.equal(cellText("a\nb\r\nc"), "a<br>b<br>c");
});
