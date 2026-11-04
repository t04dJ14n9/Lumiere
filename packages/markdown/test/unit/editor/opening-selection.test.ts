import test from "node:test";
import assert from "node:assert/strict";
import {
  openingEditorSelection,
  placeOpeningSelection,
} from "../../../src/plugins/editor/opening-selection";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

test("a Search range is the editor's opening selection", () => {
  assert.deepEqual(openingEditorSelection(100, { anchor: 9, head: 34 }), {
    anchor: 9,
    head: 34,
  });
});

test("a caret at the start is not an opening selection", () => {
  assert.equal(openingEditorSelection(100, { anchor: 0, head: 0 }), undefined);
  assert.equal(openingEditorSelection(100, undefined), undefined);
});

test("an opening selection is clamped to the note", () => {
  assert.deepEqual(openingEditorSelection(10, { anchor: 4, head: 40 }), {
    anchor: 4,
    head: 10,
  });
});

test("topLine identity is preserved on the opening selection", () => {
  assert.deepEqual(
    openingEditorSelection(200, { anchor: 40, head: 55, topLine: 12 }),
    { anchor: 40, head: 55, topLine: 12 },
  );
});

test("a caret at the start with topLine still opens (viewport pin)", () => {
  assert.deepEqual(
    openingEditorSelection(100, { anchor: 0, head: 0, topLine: 7 }),
    { anchor: 0, head: 0, topLine: 7 },
  );
});

test("placeOpeningSelection pins topLine to viewport start and keeps selection", () => {
  const doc = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n");
  let state = EditorState.create({ doc });
  const effects: unknown[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      if (spec.effects) {
        effects.push(
          ...(Array.isArray(spec.effects) ? spec.effects : [spec.effects]),
        );
      }
      state = state.update(spec).state;
    },
  } as unknown as EditorView;

  const topLine = 5;
  const anchor = state.doc.line(8).from;
  const head = state.doc.line(8).to;
  placeOpeningSelection(view, { anchor, head, topLine });

  assert.equal(state.selection.main.anchor, anchor);
  assert.equal(state.selection.main.head, head);
  assert.equal(effects.length, 1, "one scrollIntoView effect");
  // scrollIntoView normalizes the target to a SelectionRange.
  const effect = effects[0] as {
    value: { range: { from: number; to: number }; y?: string };
  };
  assert.equal(
    effect.value.range.from,
    state.doc.line(topLine + 1).from,
    "scroll target is exactly the topLine (0-based → CM 1-based)",
  );
  assert.equal(effect.value.y, "start");
});
