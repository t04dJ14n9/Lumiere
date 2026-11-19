import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CellSource, cellSyntax } from "./cell-source";
import { parseTable, serializeTable } from "../../markdown/tables/model";
import {
  operateTable,
  type TableOperation,
} from "../../markdown/tables/operations";
import type { MenuItem } from "../editor/api";
import { tableOperation } from "./commands";
import { tableMenu } from "./menu";
import { tableCommands } from "./manifest";
import { arrowStep } from "./navigation";
import { nearestEntry } from "./hit-test";
import { displayedCell } from "./content";
const source = "| head | second |\n| --- | --- |\n| value | other |";

test("cell source projection retains entered whitespace and escapes pipes without a second history", () => {
  const original = parseTable(source)!.rows[1]![0]!;
  const projection = new CellSource(original);
  const nextSource = source.replace("value", "  新 value  ");
  projection.remember("  新 value  ");
  const cell = parseTable(nextSource)!.rows[1]![0]!;
  const range = projection.range(nextSource, cell);
  assert.equal(nextSource.slice(range.from, range.to), "  新 value  ");
  const state = EditorState.create({ doc: "a", extensions: [cellSyntax] });
  const changed = state.update({ changes: { from: 1, insert: "|b\nc" } }).state;
  assert.equal(changed.doc.toString(), "a\\|b<br>c");
});

test("every contributed table command produces a valid operation and preserves an editable table", () => {
  const model = parseTable(source)!;
  for (const [id] of tableCommands) {
    const operation = tableOperation(id, { row: 1, column: 1 });
    assert.ok(operation, id);
    assert.ok(parseTable(operateTable(model, operation)), id);
  }
  const insert = tableOperation("insert-row-below", { row: 1, column: 0 })!;
  assert.equal(parseTable(operateTable(model, insert))!.rows.length, 3);
  assert.deepEqual(tableOperation("align-center", { row: 1, column: 1 }), {
    type: "align",
    from: 1,
    to: 1,
    alignment: "center",
  });
});

test("a palette command acts on the whole cell selection, as the context menu does", () => {
  const model = parseTable(
    "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |",
  )!;
  const range = { anchor: { row: 1, column: 0 }, head: { row: 2, column: 1 } };
  let executed: TableOperation | undefined;
  const menu = tableMenu(model, range, {
    copy() {},
    paste: async () => {},
    selectAll() {},
    format() {},
    clear() {},
    execute(operation) {
      executed = operation;
    },
  });
  const find = (items: readonly MenuItem[], label: string): MenuItem =>
    items.find((item) => item.label === label) ??
    items
      .map((item) => item.children && find(item.children, label))
      .find(Boolean)!;
  const run = (label: string) => {
    executed = undefined;
    void find(menu, label).run!();
    return executed;
  };
  for (const [id, label] of [
    ["insert-row-above", "Add row above"],
    ["insert-row-below", "Add row below"],
    ["insert-column-left", "Add column to the left"],
    ["insert-column-right", "Add column to the right"],
    ["delete-row", "Delete row"],
    ["delete-column", "Delete column"],
    ["duplicate-row", "Duplicate row"],
    ["duplicate-column", "Duplicate column"],
    ["move-row-up", "Move row up"],
    ["move-row-down", "Move row down"],
    ["move-column-right", "Move column right"],
    ["align-center", "Align center"],
  ] as const) {
    assert.deepEqual(tableOperation(id, range), run(label), id);
  }
});

// Obsidian 1.15.0's column commands and table menu, read from its app.js with
// REA (2026-11-07): a column added beside another takes its alignment.
test("Insert Column Left and Right align the new column as the cell's", () => {
  const model = parseTable("| a | b |\n| --- | :---: |\n| 1 | 2 |")!;
  const inserted = (id: string) =>
    parseTable(
      operateTable(model, tableOperation(id, { row: 1, column: 1 })!),
    )!;
  const left = inserted("insert-column-left");
  assert.deepEqual(left.alignments, [null, "center", "center"]);
  assert.deepEqual(
    left.rows[1]!.map((cell) => cell.text),
    ["1", "", "2"],
  );
  const right = inserted("insert-column-right");
  assert.deepEqual(right.alignments, [null, "center", "center"]);
  assert.deepEqual(
    right.rows[1]!.map((cell) => cell.text),
    ["1", "2", ""],
  );
});

test("table hit testing uses physical coordinates in RTL", () => {
  assert.deepEqual(arrowStep("ArrowLeft", true), { row: 0, column: 1 });
  const entries = [100, 50, 0].map((left) => ({
    getBoundingClientRect: () => ({
      left,
      right: left + 40,
      top: 0,
      bottom: 20,
    }),
  })) as unknown as Element[];
  assert.equal(nearestEntry(entries, "column", { x: 55, y: 0 }), 1);
  assert.equal(nearestEntry(entries, "column", { x: -100, y: 0 }), 2);
});

test("a rendered cell shows an escaped pipe without its backslash, even in code", () => {
  assert.equal(
    displayedCell("`code \\| pipe` and a \\| b"),
    "`code | pipe` and a | b",
  );
  assert.equal(displayedCell("no pipes"), "no pipes");
});

test("cell source ranges ignore new alignment padding while retaining session whitespace", () => {
  for (const alignment of [null, "left", "center", "right"] as const) {
    let source = "| a | b |\n| --- | --- |\n| x | y |";
    const projection = new CellSource(parseTable(source)!.rows[1]![0]!);
    source = serializeTable(
      [
        ["wider header", "b"],
        ["x", "y"],
      ],
      [alignment, null],
    );
    let cell = parseTable(source)!.rows[1]![0]!;
    let range = projection.range(source, cell, alignment);
    assert.equal(source.slice(range.from, range.to), "x");
    for (const text of ["  x  ", "  ", "", " z", "z "]) {
      projection.remember(text);
      source = serializeTable(
        [
          ["wider header", "b"],
          [text, "y"],
        ],
        [alignment, null],
      );
      cell = parseTable(source)!.rows[1]![0]!;
      range = projection.range(source, cell, alignment);
      assert.equal(source.slice(range.from, range.to), text);
    }
    source = serializeTable(
      [
        ["new header", "b"],
        ["external", "y"],
      ],
      [alignment, null],
    );
    cell = parseTable(source)!.rows[1]![0]!;
    range = projection.range(source, cell, alignment);
    assert.equal(source.slice(range.from, range.to), "external");
  }
});

test("typed characters and line breaks use one filtered cell transaction without accumulating escapes", () => {
  let state = EditorState.create({ extensions: [cellSyntax] });
  for (const char of "x|y\\z") {
    state = state.update(state.replaceSelection(char)).state;
  }
  assert.equal(state.doc.toString(), "x\\|y\\z");
  state = state.update(state.replaceSelection("<br>two")).state;
  assert.equal(state.doc.toString(), "x\\|y\\z<br>two");
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: "**b** `c|d`\nnext" },
  }).state;
  assert.equal(state.doc.toString(), "**b** `c\\|d`<br>next");
});
