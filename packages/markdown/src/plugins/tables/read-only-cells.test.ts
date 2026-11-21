import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseTable, type CellRange } from "../../markdown/tables/model";
import { nestedSync, noteReadOnly } from "../editor/api";
import { insertCellBreak } from "./cell-editor";
import { TableClipboard } from "./clipboard";
import { ColumnResize } from "./column-resize";
import type { TableGrid } from "./grid";
import { TableKeyboard } from "./keyboard";
import type { CellProjection } from "./projection";
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
    assert.equal(keyboard.move(0, 1), true);
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
