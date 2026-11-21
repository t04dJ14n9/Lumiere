import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  parseTable,
  type CellPosition,
  type CellRange,
} from "../../markdown/tables/model";
import { nestedSync, noteReadOnly } from "../editor/api";
import { insertCellBreak } from "./cell-editor";
import { TableClipboard } from "./clipboard";
import { ColumnResize } from "./column-resize";
import { TableController } from "./controller";
import type { CellEditor } from "./cell-editor";
import type { TableEnvironment } from "./environment";
import type { TableGrid } from "./grid";
import { TableKeyboard } from "./keyboard";
import { CellProjection } from "./projection";
import type { TableSelection } from "./selection";
import { TableToolbar } from "./toolbar";

// Edits dispatched straight to an open cell's editor do not ask its
// read-only facet, which only advises commands (#814 review). The cell's
// read-only extension drops them while the note is read-only, and the menu
// paths refuse up front, so the cell and the selection stay as they were.

const source = "| a | b |\n| --- | --- |\n| 1 | 2 |";
const range: CellRange = {
  anchor: { row: 1, column: 0 },
  head: { row: 1, column: 1 },
};

const note = (readOnly: boolean) =>
  EditorState.create({
    doc: source,
    extensions: EditorState.readOnly.of(readOnly),
  });

/** An open cell's editor over `text`, carrying the note's read-only state. */
function cellView(text: string, readOnly: boolean, from = 0, to = from) {
  let state = EditorState.create({
    doc: text,
    selection: EditorSelection.range(from, to),
    extensions: noteReadOnly(note(readOnly)),
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
    focus() {},
  } as unknown as EditorView;
  return view;
}

test("a read-only note's open cell drops changes, whatever dispatches them", () => {
  for (const readOnly of [true, false]) {
    const view = cellView("x", readOnly, 1);
    view.dispatch(view.state.replaceSelection("y"));
    assert.equal(view.state.doc.toString(), readOnly ? "x" : "xy");
    // Bringing the cell's text to the note's is no edit: it always applies.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "synced" },
      annotations: nestedSync.of(true),
    });
    assert.equal(view.state.doc.toString(), "synced");
  }
});

test("Shift+Enter in a read-only note's cell adds no <br>", () => {
  for (const readOnly of [true, false]) {
    const view = cellView("ab", readOnly, 1);
    insertCellBreak(view);
    assert.equal(view.state.doc.toString(), readOnly ? "ab" : "a<br>b");
  }
});

/** The clipboard over one table, its open cell `inner`, all without DOM. */
function clipboard(
  readOnly: boolean,
  options: { inner?: EditorView; range?: CellRange; pasted?: string } = {},
) {
  const calls = {
    copied: [] as string[],
    replaced: 0,
    activated: 0,
    closed: 0,
    read: 0,
  };
  const selection = {
    range: options.range,
    activate: () => calls.activated++,
    highlight() {},
  };
  const instance = new TableClipboard(
    {
      outer: { state: note(readOnly), focus() {} },
      model: parseTable(source)!,
      block: { source },
      root: { isConnected: true, focus() {} },
      replace: () => {
        calls.replaced++;
        return !readOnly;
      },
    } as unknown as TableGrid,
    {
      inner: options.inner,
      active: { row: 1, column: 0 },
      sessionRevision: 0,
      close: () => calls.closed++,
    } as unknown as CellProjection,
    selection as unknown as TableSelection,
    {
      copy: (text: string) => calls.copied.push(text),
      paste: async () => {
        calls.read++;
        return options.pasted ?? "";
      },
      wrap: () => true,
      clearFormatting: (text: string) => text.replaceAll("**", ""),
      canFormat: true,
    },
  );
  return { instance, calls, selection };
}

test("Cut from the menu copies a read-only note's cell text but leaves it", () => {
  for (const readOnly of [true, false]) {
    const inner = cellView("hello", readOnly, 0, 2);
    const { instance, calls } = clipboard(readOnly, { inner });
    instance.copyFromMenu(range, true);
    assert.deepEqual(calls.copied, ["he"]);
    assert.equal(inner.state.doc.toString(), readOnly ? "hello" : "llo");
  }
});

test("Cut from the menu over cells of a read-only note neither selects nor clears them", () => {
  for (const readOnly of [true, false]) {
    const { instance, calls } = clipboard(readOnly, { range });
    instance.copyFromMenu(range, true);
    assert.equal(calls.copied.length, 1);
    assert.equal(calls.activated, readOnly ? 0 : 1);
    assert.equal(calls.replaced, readOnly ? 0 : 1);
  }
});

test("Paste from the menu into a read-only note's cell changes nothing", async () => {
  for (const readOnly of [true, false]) {
    // One line goes into the open cell.
    const inner = cellView("ab", readOnly, 1);
    const single = clipboard(readOnly, { inner, pasted: "X" });
    await single.instance.pasteFromMenu(range);
    assert.equal(inner.state.doc.toString(), readOnly ? "ab" : "aXb");
    assert.equal(single.calls.read, readOnly ? 0 : 1);
    // Cells (a tab) close the cell and are written over the range.
    const many = clipboard(readOnly, {
      inner: cellView("ab", readOnly, 1),
      pasted: "x\ty",
    });
    await many.instance.pasteFromMenu(range);
    assert.equal(many.calls.closed, readOnly ? 0 : 1);
    assert.equal(many.selection.range, readOnly ? undefined : range);
    assert.equal(many.calls.replaced, readOnly ? 0 : 1);
  }
});

test("Clear formatting from the menu leaves a read-only note's cell and its selection", () => {
  for (const readOnly of [true, false]) {
    const inner = cellView("**bold** x", readOnly, 3);
    const { instance } = clipboard(readOnly, { inner });
    instance.formatCells(range, null);
    assert.equal(
      inner.state.doc.toString(),
      readOnly ? "**bold** x" : "bold x",
    );
    // The cell's formatting starts by selecting all of it; not here.
    if (readOnly) {
      assert.deepEqual(inner.state.selection.main.toJSON(), {
        anchor: 3,
        head: 3,
      });
    }
  }
});

test("Tab past the last row of a read-only note's table leaves no cell waiting to open", () => {
  for (const readOnly of [true, false]) {
    const requests: unknown[] = [];
    const keyboard = new TableKeyboard(
      {
        model: parseTable(source)!,
        replace: () => !readOnly,
      } as unknown as TableGrid,
      { active: { row: 1, column: 1 }, inner: undefined } as never,
      {} as never,
      { request: (position: unknown) => requests.push(position) } as never,
    );
    // Nothing written: the key is not taken.
    assert.equal(keyboard.move(0, 1), !readOnly);
    assert.deepEqual(
      requests.at(-1),
      readOnly ? undefined : { row: 2, column: 0 },
    );
  }
});

test("the table's + strips leave no cell waiting to open in a read-only note", () => {
  for (const readOnly of [true, false]) {
    const requests: unknown[] = [];
    const toolbar = new TableToolbar(
      {
        model: parseTable(source)!,
        replace: () => !readOnly,
      } as unknown as TableGrid,
      { request: (position: unknown) => requests.push(position) } as never,
      {} as TableClipboard,
      () => () => {},
    );
    toolbar.addRow();
    assert.deepEqual(
      requests.at(-1),
      readOnly ? undefined : { row: 2, column: 0 },
    );
    toolbar.addColumn();
    assert.deepEqual(
      requests.at(-1),
      readOnly ? undefined : { row: 0, column: 2 },
    );
  }
});

test("a handle's move keeps the column widths when nothing is written", () => {
  for (const written of [false, true]) {
    const resize = Object.create(ColumnResize.prototype) as ColumnResize;
    const widths = [100, 200];
    Object.assign(resize, { widths });
    const result = resize.remapFor(
      { type: "move", axis: "column", from: 0, to: 0, destination: 1 },
      () => written,
    );
    assert.equal(result, written);
    const now = (resize as unknown as { widths: number[] }).widths;
    assert.deepEqual(now, written ? [200, 100] : widths);
  }
});

/** A grid over the one table, without DOM, whose note may change state. */
function gridOver(state: () => EditorState) {
  return {
    outer: {
      get state() {
        return state();
      },
      focus() {},
    },
    model: parseTable(source)!,
    block: { source },
    root: { isConnected: true, focus() {} },
    contentElement: () => ({ replaceChildren() {} }),
    display() {},
    replace: () => !state().readOnly,
  } as unknown as TableGrid;
}

/** A projection with cell (1, 0) already open, showing `text`. */
function openProjection(grid: TableGrid, inner: EditorView) {
  const projection = new CellProjection(grid, {} as TableEnvironment, {
    activate() {},
    highlight() {},
    move: () => false,
    arrow: () => false,
  });
  let destroyed = 0;
  projection.active = { row: 1, column: 0 };
  projection.cellEditor = {
    view: inner,
    destroy: () => destroyed++,
  } as unknown as CellEditor;
  return { projection, destroyed: () => destroyed };
}

test("in a read-only note, Up or Down into a table opens no cell, so the key moves the caret on", () => {
  const grid = gridOver(() => note(true));
  const projection = new CellProjection(grid, {} as TableEnvironment, {
    activate() {},
    highlight() {},
    move: () => false,
    arrow: () => false,
  });
  const controller = Object.create(TableController.prototype);
  Object.assign(controller, {
    keyboard: new TableKeyboard(grid, projection, {} as never, {} as never),
  });
  for (const direction of [1, -1] as const) {
    assert.equal((controller as TableController).enter(direction), false);
  }
  assert.equal(projection.active, undefined);
});

test("a cell open when the note turned read-only stays for itself but closes for another", () => {
  const grid = gridOver(() => note(true));
  const same = openProjection(grid, cellView("one", true, 0, 2));
  assert.equal(same.projection.open({ row: 1, column: 0 }), true);
  assert.equal(same.destroyed(), 0);
  const other = openProjection(grid, cellView("one", true, 0, 2));
  assert.equal(other.projection.open({ row: 1, column: 1 }), false);
  assert.equal(other.destroyed(), 1);
  assert.equal(other.projection.active, undefined);
});

test("Copy from the menu of a right-clicked cell copies that cell, not one left open", () => {
  for (const [column, copied] of [
    [1, "2"],
    // The open cell itself: its selected text, as before.
    [0, "on"],
  ] as const) {
    const grid = gridOver(() => note(true));
    const { projection } = openProjection(grid, cellView("one", true, 0, 2));
    const copies: string[] = [];
    const clipboard = new TableClipboard(
      grid,
      projection,
      { range: undefined } as unknown as TableSelection,
      {
        copy: (text: string) => copies.push(text),
        paste: async () => "",
        wrap: () => true,
        clearFormatting: (text: string) => text,
        canFormat: true,
      },
    );
    let items: { label?: string; run?: () => void }[] = [];
    const toolbar = new TableToolbar(
      grid,
      {
        range: () => undefined,
        active: () => projection.active,
        open: (position) => projection.open(position),
        select() {},
        request() {},
        execute() {},
        selectAll() {},
      },
      clipboard,
      (_root, menu) => {
        items = menu as typeof items;
        return () => {};
      },
    );
    toolbar.showMenu({ row: 1, column }, { x: 0, y: 0 });
    items.find((item) => item.label === "Copy")!.run!();
    assert.deepEqual(copies, [copied]);
  }
});

test("Paste from the menu writes nothing when the note turns read-only while the clipboard is read", async () => {
  for (const turnsReadOnly of [true, false]) {
    let readOnly = false;
    const grid = gridOver(() => note(readOnly));
    // Open before the note turned read-only, so the cell itself is writable.
    const inner = cellView("ab", false, 1);
    const { projection, destroyed } = openProjection(grid, inner);
    const selection = {
      range: undefined as CellRange | undefined,
      highlight() {},
    };
    for (const pasted of ["X", "x\ty"]) {
      const clipboard = new TableClipboard(
        grid,
        projection,
        selection as unknown as TableSelection,
        {
          copy() {},
          paste: async () => {
            readOnly = turnsReadOnly;
            return pasted;
          },
          wrap: () => true,
          clearFormatting: (text: string) => text,
          canFormat: true,
        },
      );
      readOnly = false;
      await clipboard.pasteFromMenu(range);
    }
    assert.equal(inner.state.doc.toString(), turnsReadOnly ? "ab" : "aXb");
    assert.equal(destroyed(), turnsReadOnly ? 0 : 1);
    assert.equal(selection.range, turnsReadOnly ? undefined : range);
  }
});

/**
 * The keyboard over a three-row table of a read-only note, without DOM.
 * `focused` follows where the focus is: the grid, the note, an open cell,
 * or nowhere (the page's body, when a focused cell is destroyed).
 */
function readOnlyKeyboard(openCell?: CellPosition) {
  const tall = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
  let focused = openCell ? "cell" : "grid";
  const grid = {
    outer: {
      state: EditorState.create({
        doc: tall,
        extensions: EditorState.readOnly.of(true),
      }),
      focus: () => (focused = "note"),
      dispatch() {},
    },
    model: parseTable(tall)!,
    block: { source: tall },
    start: () => 0,
    root: { isConnected: true, focus: () => (focused = "grid") },
    contentElement: () => ({ replaceChildren() {} }),
    display() {},
    replace: () => false,
  } as unknown as TableGrid;
  const projection = new CellProjection(grid, {} as TableEnvironment, {
    activate() {},
    highlight() {},
    move: () => false,
    arrow: () => false,
  });
  if (openCell) {
    projection.active = openCell;
    projection.cellEditor = {
      view: cellView("1", true),
      destroy: () => {
        if (focused === "cell") {
          focused = "body";
        }
      },
    } as unknown as CellEditor;
  }
  const selection = {
    range: undefined as CellRange | undefined,
    // As TableSelection's: selecting cells closes the open cell.
    select(next: CellRange) {
      projection.close();
      this.range = next;
    },
    highlight() {},
  };
  const keyboard = new TableKeyboard(
    grid,
    projection,
    selection as unknown as TableSelection,
    { request() {}, deactivate() {}, menu() {} } as never,
  );
  return { keyboard, selection, focused: () => focused };
}

const cell = (row: number, column: number) => ({
  anchor: { row, column },
  head: { row, column },
});

test("in a read-only note the arrows move the selected cell through the table", () => {
  const { keyboard, selection, focused } = readOnlyKeyboard();
  // Select all, then Down: the selection collapses to the last cell.
  selection.range = {
    anchor: { row: 0, column: 0 },
    head: { row: 2, column: 1 },
  };
  assert.equal(keyboard.arrow({ row: 1, column: 0 }, false), true);
  assert.deepEqual(selection.range, cell(2, 1));
  // Then each arrow moves it, where it used to stay (the key was taken).
  assert.equal(keyboard.arrow({ row: -1, column: 0 }, false), true);
  assert.deepEqual(selection.range, cell(1, 1));
  assert.equal(keyboard.arrow({ row: 0, column: -1 }, false), true);
  assert.deepEqual(selection.range, cell(1, 0));
  assert.equal(focused(), "grid");
  // Down twice: to the last row, then out of the table into the note.
  keyboard.arrow({ row: 1, column: 0 }, false);
  assert.deepEqual(selection.range, cell(2, 0));
  assert.equal(keyboard.arrow({ row: 1, column: 0 }, false), true);
  assert.equal(selection.range, undefined);
  assert.equal(focused(), "note");
});

test("Tab or Right from a cell left open in a read-only note moves the focus to the grid, never nowhere", () => {
  for (const key of ["Tab", "ArrowRight"]) {
    const { keyboard, selection, focused } = readOnlyKeyboard({
      row: 1,
      column: 0,
    });
    const handled =
      key === "Tab"
        ? keyboard.move(0, 1)
        : keyboard.arrow({ row: 0, column: 1 }, false);
    assert.equal(handled, true, key);
    assert.equal(focused(), "grid", key);
    assert.deepEqual(selection.range, cell(1, 1), key);
  }
});

test("in a read-only note the menu of a cell outside the grid selection acts on that cell", () => {
  const tall = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
  for (const [clicked, copied] of [
    [{ row: 0, column: 0 }, "a"],
    // Inside the selection: the selection stays the menu's target.
    [{ row: 2, column: 1 }, "4"],
  ] as const) {
    const grid = {
      outer: { state: note(true), focus() {} },
      model: parseTable(tall)!,
      block: { source: tall },
      root: { isConnected: true, focus() {} },
      contentElement: () => ({ replaceChildren() {} }),
      display() {},
    } as unknown as TableGrid;
    const projection = new CellProjection(grid, {} as TableEnvironment, {
      activate() {},
      highlight() {},
      move: () => false,
      arrow: () => false,
    });
    // The grid selection the keys left on (2, 1), and its highlight.
    const selection = {
      range: cell(2, 1) as CellRange | undefined,
      select(next: CellRange) {
        this.range = next;
      },
    };
    const copies: string[] = [];
    const clipboard = new TableClipboard(
      grid,
      projection,
      selection as unknown as TableSelection,
      {
        copy: (text: string) => copies.push(text),
        paste: async () => "",
        wrap: () => true,
        clearFormatting: (text: string) => text,
        canFormat: true,
      },
    );
    let items: { label?: string; run?: () => void }[] = [];
    const toolbar = new TableToolbar(
      grid,
      {
        range: () => selection.range,
        active: () => projection.active,
        open: (position) => projection.open(position),
        select: (next) => selection.select(next),
        request() {},
        execute() {},
        selectAll() {},
      },
      clipboard,
      (_root, menu) => {
        items = menu as typeof items;
        return () => {};
      },
    );
    toolbar.showMenu(clicked, { x: 0, y: 0 });
    items.find((item) => item.label === "Copy")!.run!();
    assert.deepEqual(copies, [copied]);
    assert.deepEqual(selection.range, cell(clicked.row, clicked.column));
  }
});
