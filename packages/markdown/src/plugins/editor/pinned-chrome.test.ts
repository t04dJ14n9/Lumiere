import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { pinnedChromeHeight } from "./api";

const view = {} as EditorView;

test("a note with nothing pinned over it has no chrome height", () => {
  const height = EditorState.create().facet(pinnedChromeHeight);
  assert.equal(height(view, 0), 0);
});

test("the chrome height is the tallest chrome that a plugin pins", () => {
  const state = EditorState.create({
    extensions: [
      pinnedChromeHeight.of((_view, position) => position),
      pinnedChromeHeight.of(() => 49),
      pinnedChromeHeight.of(() => 0),
    ],
  });
  const height = state.facet(pinnedChromeHeight);
  assert.equal(height(view, 10), 49);
  assert.equal(height(view, 100), 100);
});
