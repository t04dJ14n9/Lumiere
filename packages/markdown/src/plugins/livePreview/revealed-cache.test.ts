import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { cachedRevealRanges, revealed } from "./registry";

const doc = "alpha beta gamma delta epsilon";

test("revealed() keeps its inclusive touch rules", () => {
  const state = EditorState.create({ doc, selection: { anchor: 6, head: 10 } });
  assert.equal(revealed(state, 6, 10), true);
  assert.equal(revealed(state, 10, 11), true, "inclusive endpoints");
  assert.equal(revealed(state, 0, 5), false);
  assert.equal(revealed(state, 11, 16), false);
});

test("reveal ranges are computed once per immutable state", () => {
  const state = EditorState.create({ doc, selection: { anchor: 6, head: 10 } });
  const ranges = cachedRevealRanges(state);
  assert.equal(cachedRevealRanges(state), ranges, "same array object reused");
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0]!.from, 6);
  assert.equal(ranges[0]!.to, 10);
  // A different state must not reuse the previous state's ranges.
  const moved = state.update({ selection: { anchor: 0 } }).state;
  assert.notEqual(cachedRevealRanges(moved), ranges);
  assert.equal(revealed(moved, 6, 10), false);
});
