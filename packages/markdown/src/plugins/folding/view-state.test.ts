import test from "node:test";
import assert from "node:assert/strict";
import { foldEffect, foldState, foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { foldedViewState } from "./view-state";

function fakeView(doc: string) {
  let state = EditorState.create({ doc, extensions: [foldState] });
  return {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
}

function folds(view: EditorView): string[] {
  const found: string[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    found.push(view.state.sliceDoc(from, to));
  });
  return found;
}

const NOTE = "# One\nfirst body\n# Two\nsecond body\n";

function savedFolds() {
  const view = fakeView(NOTE);
  const from = NOTE.indexOf("\nfirst");
  const to = NOTE.indexOf("\n# Two");
  view.dispatch({ effects: foldEffect.of({ from, to }) });
  return foldedViewState.schema.parse(foldedViewState.capture(view));
}

test("saved folds come back on the same text", () => {
  const view = fakeView(NOTE);
  foldedViewState.restore(view, savedFolds());
  assert.deepEqual(folds(view), ["\nfirst body"]);
});

test("a saved fold is dropped when the note changed outside the panel", () => {
  // Text added above the section: the saved offsets now fall elsewhere.
  const view = fakeView(`intro line\n${NOTE}`);
  foldedViewState.restore(view, savedFolds());
  assert.deepEqual(folds(view), []);
});

test("folds saved before their lines were recorded are restored by offset", () => {
  const view = fakeView(NOTE);
  foldedViewState.restore(view, [{ from: 5, to: 16 }]);
  assert.deepEqual(folds(view), ["\nfirst body"]);
});

test("a saved fold with a malformed record of its lines is rejected", () => {
  assert.throws(() =>
    foldedViewState.schema.parse([{ from: 1, to: 4, edges: ["only one"] }]),
  );
});
