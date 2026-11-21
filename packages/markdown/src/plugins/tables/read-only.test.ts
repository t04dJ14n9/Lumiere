import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseTable } from "../../markdown/tables/model";
import { followNoteReadOnly, noteReadOnly } from "../editor/api";
import { followReadOnlyChange, watchNoteReadOnly } from "./cell-read-only";
import { tableOperation } from "./commands";
import { TableController } from "./controller";
import type { TableEnvironment } from "./environment";
import { TableGrid } from "./grid";
import { TableKeyboard } from "./keyboard";
import { CellProjection } from "./projection";
import { TableSelection } from "./selection";

// A note turns read-only when syncing fails for good (document/sync.ts). A
// table cell is edited in a view of its own, so it must carry the note's
// read-only state, and nothing a table does may write a read-only note.

const source = "| a | b |\n| --- | --- |\n| 1 | 2 |";
const note = (readOnly: boolean, doc = source) =>
  EditorState.create({ doc, extensions: EditorState.readOnly.of(readOnly) });

/** The note's editor: its state, and a count of what it dispatched. */
function outerView(readOnly: boolean) {
  let state = note(readOnly);
  let dispatches = 0;
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      dispatches++;
      state = state.update(spec).state;
    },
    focus() {},
    posAtDOM: () => 0,
  } as unknown as EditorView;
  return {
    view,
    dispatches: () => dispatches,
    setReadOnly(next: boolean) {
      state = note(next, state.doc.toString());
    },
  };
}

test("a cell opens read-only in a read-only note, and follows the note when it changes", () => {
  for (const readOnly of [true, false]) {
    const cell = EditorState.create({
      doc: "1",
      extensions: noteReadOnly(note(readOnly)),
    });
    assert.equal(cell.readOnly, readOnly);
    // Nothing to do while they agree.
    assert.equal(followNoteReadOnly(cell, note(readOnly)), undefined);
    const spec = followNoteReadOnly(cell, note(!readOnly));
    assert.ok(spec);
    assert.equal(cell.update(spec).state.readOnly, !readOnly);
  }
});

test("open cells hear when their note turns read-only or writable, until they close", () => {
  const outer = {} as EditorView;
  const other = {} as EditorView;
  let followed = 0;
  const stop = watchNoteReadOnly(outer, {
    followReadOnly: () => {
      followed++;
    },
  });
  const update = (view: EditorView, from: boolean, to: boolean) =>
    followReadOnlyChange({ view, startState: note(from), state: note(to) });
  update(outer, false, false);
  assert.equal(followed, 0);
  update(outer, false, true);
  update(outer, true, false);
  assert.equal(followed, 2);
  update(other, false, true);
  assert.equal(followed, 2);
  stop();
  update(outer, false, true);
  assert.equal(followed, 2);
});

/** A projection over a one-table note, its grid without DOM. */
function projection(outer: EditorView) {
  const activated: unknown[] = [];
  const grid = {
    outer,
    model: parseTable(source)!,
    contentElement: () => ({ replaceChildren() {} }),
    locate: () => 0,
    tableSource: () => source,
    display() {},
  } as unknown as TableGrid;
  const instance = new CellProjection(
    grid,
    { disposeContent() {} } as unknown as TableEnvironment,
    {
      activate: (position) => activated.push(position),
      highlight() {},
      move: () => false,
      arrow: () => false,
    },
  );
  return { instance, activated };
}

test("no cell opens in a read-only note", () => {
  for (const readOnly of [true, false]) {
    const outer = outerView(readOnly);
    const { instance, activated } = projection(outer.view);
    try {
      instance.open({ row: 1, column: 0 });
    } catch {
      // A writable note gets as far as building the cell's view, which
      // needs a DOM these tests do not have.
    }
    assert.equal(activated.length, readOnly ? 0 : 1);
    assert.equal(instance.active === undefined, readOnly);
  }
});

test("a cell's edit is not written into a read-only note", () => {
  for (const readOnly of [true, false]) {
    const outer = outerView(readOnly);
    const { instance } = projection(outer.view);
    instance["projectChange"]({ row: 1, column: 0 }, "changed", "input");
    assert.equal(outer.dispatches(), readOnly ? 0 : 1);
    assert.equal(outer.view.state.doc.toString() === source, readOnly);
  }
});

test("a press on a read-only note's table neither opens a cell nor starts a selection", () => {
  const globals = globalThis as { Node?: unknown; Element?: unknown };
  const saved = { Node: globals.Node, Element: globals.Element };
  // The press handler asks whether its target is a DOM node or element.
  globals.Node ??= class {};
  globals.Element ??= class {};
  try {
    for (const readOnly of [true, false]) {
      const outer = outerView(readOnly);
      const begun: unknown[] = [];
      const selection = Object.create(TableSelection.prototype);
      Object.assign(selection, {
        grid: {
          outer: outer.view,
          model: parseTable(source)!,
          position: () => ({ row: 1, column: 0 }),
          contentElement: () => ({}),
        },
        projection: { inner: undefined },
        positionInText: () => 0,
        drag: { begin: (...args: unknown[]) => begun.push(args) },
      });
      let prevented = false;
      (selection as TableSelection).pointerDown({
        target: {},
        button: 0,
        isPrimary: true,
        shiftKey: false,
        preventDefault() {
          prevented = true;
        },
      } as unknown as PointerEvent);
      assert.equal(begun.length, readOnly ? 0 : 1);
      assert.equal(prevented, !readOnly);
    }
  } finally {
    globals.Node = saved.Node;
    globals.Element = saved.Element;
  }
});

test("a table write refuses a read-only note", () => {
  for (const readOnly of [true, false]) {
    const outer = outerView(readOnly);
    const grid = Object.create(TableGrid.prototype) as TableGrid;
    Object.assign(grid, {
      root: { isConnected: true },
      outer: outer.view,
      block: { kind: "Table", from: 0, to: source.length, source },
      model: parseTable(source)!,
      operationSequence: 0,
    });
    const written = grid.replace("| x | y |\n| --- | --- |\n| 1 | 2 |");
    assert.equal(written, !readOnly);
    assert.equal(outer.dispatches(), readOnly ? 0 : 1);
  }
});

test("a sort whose note turns read-only while its keys render writes nothing", async () => {
  const unsorted = "| a |\n| --- |\n| z |\n| y |";
  for (const turnsReadOnly of [true, false]) {
    const outer = outerView(false);
    let replaced = 0;
    let closed = 0;
    const controller = Object.create(TableController.prototype);
    Object.assign(controller, {
      grid: {
        outer: outer.view,
        model: parseTable(unsorted)!,
        block: { source: unsorted },
        tableSource: () => unsorted,
        sourceFor: (table: string) => table,
        locate: () => 0,
        shownTexts: async () => {
          if (turnsReadOnly) {
            outer.setReadOnly(true);
          }
          return ["a", "z", "y"];
        },
        replace: () => {
          replaced++;
          return true;
        },
      },
      projection: { inner: undefined },
      events: new AbortController(),
      selected: {},
      columnResize: { remap() {} },
      close: () => {
        closed++;
      },
    });
    const sort = tableOperation("sort-ascending", { row: 1, column: 0 })!;
    await (controller as TableController).execute(sort, { row: 1, column: 0 });
    assert.equal(replaced, turnsReadOnly ? 0 : 1);
    // The open cell is not closed for a write that does not happen.
    assert.equal(closed, turnsReadOnly ? 0 : 1);
  }
});

test("leaving a read-only note's table at the note's end adds no blank line", () => {
  for (const readOnly of [true, false]) {
    const outer = outerView(readOnly);
    const keyboard = new TableKeyboard(
      {
        outer: outer.view,
        start: () => 0,
        block: { source },
        commandGroup: () => "table-command-1",
      } as unknown as TableGrid,
      { close() {}, active: undefined } as unknown as CellProjection,
      { range: undefined, highlight() {} } as unknown as TableSelection,
      { deactivate() {} } as never,
    );
    keyboard.leave(1);
    assert.equal(outer.view.state.doc.toString() === source, readOnly);
  }
});
