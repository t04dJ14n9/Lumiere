import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseTable } from "../../markdown/tables/model";
import { TableGrid } from "./grid";

const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
const note = `Intro paragraph\n\n${table}\n\nTail`;
const tableFrom = note.indexOf(table);

interface FakeOuter {
  view: EditorView;
  state(): EditorState;
}

/**
 * The outer editor as CodeMirror sees it: `posAtDOM` of a detached widget
 * root is 0 or the note's end, never the table.
 */
function outerEditor(doc: string, rootPosition: () => number): FakeOuter {
  let state = EditorState.create({ doc });
  const view = {
    get state() {
      return state;
    },
    posAtDOM: () => rootPosition(),
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  return { view, state: () => state };
}

/** A grid without DOM: only the source bookkeeping these tests exercise. */
function grid(
  outer: EditorView,
  options: { connected: boolean; from?: number; source?: string },
): TableGrid {
  const source = options.source ?? table;
  const instance = Object.create(TableGrid.prototype) as TableGrid;
  const rendered: { text: string; offset: number }[] = [];
  Object.assign(instance, {
    root: { isConnected: options.connected },
    outer,
    block: {
      kind: "Table",
      from: options.from ?? tableFrom,
      to: (options.from ?? tableFrom) + source.length,
      source,
    },
    model: parseTable(source)!,
    cells: [],
    rendered,
    content: {
      disposeContent() {},
      renderContent(_element: unknown, text: string, offset: number) {
        // TableContent asks the note for this offset's line; past the end
        // CodeMirror throws a RangeError.
        outer.state.doc.lineAt(offset);
        rendered.push({ text, offset });
      },
    },
    operationSequence: 0,
  });
  return instance;
}

test("a table command on an unmounted table leaves the note as it was", () => {
  for (const detachedPosition of [0, note.length]) {
    const outer = outerEditor(note, () => detachedPosition);
    const target = grid(outer.view, { connected: false });
    const written = target.replace("| x | y |\n| --- | --- |\n| 1 | 2 |");
    assert.equal(outer.state().doc.toString(), note);
    assert.equal(written, false);
  }
});

test("a table command whose table is no longer at its place writes nothing", () => {
  // The root is mounted, but the note around it changed under the snapshot.
  const outer = outerEditor(note, () => 0);
  const target = grid(outer.view, { connected: true });
  const written = target.replace("| x | y |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(outer.state().doc.toString(), note);
  assert.equal(written, false);
});

test("a table command on a mounted table replaces exactly the table", () => {
  const outer = outerEditor(note, () => tableFrom);
  const target = grid(outer.view, { connected: true });
  assert.equal(target.replace("| x | y |\n| --- | --- |\n| 1 | 2 |"), true);
  assert.equal(
    outer.state().doc.toString(),
    note.replace(table, "| x | y |\n| --- | --- |\n| 1 | 2 |"),
  );
});
