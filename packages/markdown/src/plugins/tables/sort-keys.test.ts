import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import {
  parseTable,
  type CellPosition,
  type Table,
} from "../../markdown/tables/model";
import { operateTable } from "../../markdown/tables/operations";
import { editGroup } from "../document/api";
import { shownColumn, withShownText, type ShownCells } from "./sort-keys";

/** What a cell shows: bold and code lose their markers, as rendered. */
const rendered = (markdown: string) => markdown.replace(/\*\*|`/g, "");

/**
 * A table's cells as the grid has them: each shows its rendering, except
 * the active one, whose element holds the cell editor with the Markdown.
 */
function cellsWith(table: Table, active: CellPosition | undefined) {
  const renders: string[] = [];
  const isActive = (position: CellPosition) =>
    active?.row === position.row && active.column === position.column;
  const markdown = (position: CellPosition) =>
    table.rows[position.row]![position.column]!.text;
  const cells: ShownCells = {
    renderedSource: (position) =>
      isActive(position) ? undefined : markdown(position),
    elementText: (position) =>
      isActive(position) ? markdown(position) : rendered(markdown(position)),
    async renderText(text) {
      renders.push(text);
      return rendered(text);
    },
  };
  return { cells, renders };
}

const source = "| name |\n| --- |\n| **z** |\n| a |";

async function sortedFrom(active: CellPosition | undefined) {
  const table = parseTable(source)!;
  const { cells, renders } = cellsWith(table, active);
  const shown = await shownColumn(table, 0, cells);
  const sorted = operateTable(table, {
    type: "sort",
    column: 0,
    direction: "ascending",
    shown,
  });
  return { shown, sorted, renders };
}

test("a sort from the formatted cell being edited orders rows as one from the header does (#808)", async () => {
  const fromBody = await sortedFrom({ row: 1, column: 0 });
  const fromHeader = await sortedFrom({ row: 0, column: 0 });
  const fromNoCell = await sortedFrom(undefined);
  assert.deepEqual(fromBody.shown, ["name", "z", "a"]);
  assert.deepEqual(
    parseTable(fromBody.sorted)!
      .rows.slice(1)
      .map((row) => row[0]!.text),
    ["a", "**z**"],
  );
  assert.equal(fromBody.sorted, fromHeader.sorted);
  assert.equal(fromBody.sorted, fromNoCell.sorted);
  // Only the cell being edited is rendered for the sort; the others give
  // the text they show.
  assert.deepEqual(fromBody.renders, ["**z**"]);
  assert.deepEqual(fromNoCell.renders, []);
});

test("a cell whose element shows other text than its Markdown, or none yet, is rendered for the sort", async () => {
  const table = parseTable("| n |\n| --- |\n| `b` |\n| a |")!;
  const renders: string[] = [];
  const shown = await shownColumn(table, 0, {
    // The first body cell still shows its old text; the second is rendering.
    renderedSource: (position) =>
      position.row === 1 ? "`old`" : position.row === 2 ? undefined : "n",
    elementText: (position) => (position.row === 0 ? "n" : ""),
    async renderText(text) {
      renders.push(text);
      return rendered(text);
    },
  });
  assert.deepEqual(shown, ["n", "b", "a"]);
  assert.deepEqual(renders, ["`b`", "a"]);
});

/** A note holding `source`, with the grid's view of it for a sort. */
function noteWithTable(active: CellPosition) {
  const note = `Before\n\n${source}\n\nAfter`;
  const from = note.indexOf(source);
  let state = EditorState.create({ doc: note, extensions: history() });
  let transactions = 0;
  const run = (tr: Transaction) => {
    transactions++;
    state = tr.state;
  };
  const tableSource = () =>
    state.sliceDoc(from, from + parseTable(source)!.source.length);
  const grid = {
    tableSource,
    shownTexts: (column: number) => {
      const table = parseTable(tableSource())!;
      return shownColumn(table, column, cellsWith(table, active).cells);
    },
  };
  return {
    note,
    from,
    grid,
    run,
    state: () => state,
    transactions: () => transactions,
  };
}

test("the sort from the cell being edited is one edit, which one undo takes back (#808)", async () => {
  const fixture = noteWithTable({ row: 1, column: 0 });
  const sort = await withShownText(fixture.grid, {
    type: "sort",
    column: 0,
    direction: "ascending",
  });
  assert.ok(sort);
  // Reading the keys left the note alone; the cell editor is not closed.
  assert.equal(fixture.transactions(), 0);
  // As the grid writes a table operation: one change in its own edit group.
  const table = parseTable(fixture.grid.tableSource())!;
  fixture.run(
    fixture.state().update({
      changes: {
        from: fixture.from,
        to: fixture.from + table.source.length,
        insert: operateTable(table, sort),
      },
      annotations: editGroup.of("table-command-1"),
    }),
  );
  const after = "Before\n\n| name  |\n| ----- |\n| a     |\n| **z** |\n\nAfter";
  assert.equal(fixture.state().doc.toString(), after);
  assert.equal(fixture.transactions(), 1);
  assert.equal(undo({ state: fixture.state(), dispatch: fixture.run }), true);
  assert.equal(fixture.state().doc.toString(), fixture.note);
  assert.equal(redo({ state: fixture.state(), dispatch: fixture.run }), true);
  assert.equal(fixture.state().doc.toString(), after);
});

test("a table edited while its cells render for a sort is left as it is", async () => {
  const fixture = noteWithTable({ row: 1, column: 0 });
  const sort = withShownText(
    {
      tableSource: fixture.grid.tableSource,
      shownTexts: (column) => {
        const keys = fixture.grid.shownTexts(column);
        // Typing in the cell before its rendering for the key is done.
        fixture.run(
          fixture.state().update({
            changes: { from: fixture.note.indexOf("z"), insert: "y" },
          }),
        );
        return keys;
      },
    },
    { type: "sort", column: 0, direction: "ascending" },
  );
  assert.equal(await sort, undefined);
});
