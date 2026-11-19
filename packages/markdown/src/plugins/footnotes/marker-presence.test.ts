import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Text } from "@codemirror/state";
import { gainedFootnoteMarker, hasFootnoteMarker } from "./marker-presence";

function edit(
  doc: string,
  changes: { from: number; to?: number; insert?: string },
) {
  const tr = EditorState.create({ doc }).update({ changes });
  return gainedFootnoteMarker(tr.changes, tr.newDoc);
}

test("an edit that writes or joins `[^` gains a footnote marker", () => {
  assert.equal(edit("text", { from: 4, insert: " [^1]" }), true);
  assert.equal(edit("a [ b", { from: 3, insert: "^" }), true);
  assert.equal(edit("a [x^ b", { from: 3, to: 4 }), true);
  assert.equal(edit("[\n^", { from: 1, to: 2 }), true);
});

test("an edit elsewhere in a note without `[^` gains none, whatever the note's length", () => {
  const long = "plain text\n".repeat(10_000);
  assert.equal(edit(long, { from: 5, insert: "x" }), false);
  assert.equal(edit(long, { from: 5, insert: "\n- [x] " }), false);
  // A marker far from the change is not read: callers know the note had none.
  assert.equal(
    edit(`[^1]\n${long}`, { from: long.length, insert: "x" }),
    false,
  );
});

test("a note's markers are found line by line", () => {
  assert.equal(hasFootnoteMarker(Text.of(["a", "b [^1]: c"])), true);
  assert.equal(hasFootnoteMarker(Text.of(["a [", "^ b"])), false);
  assert.equal(hasFootnoteMarker(Text.of([""])), false);
});
