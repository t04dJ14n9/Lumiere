import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { documentTree } from "./document-tree";
import { headingDragStart } from "./heading-drag";

const doc =
  "# Title here\n\nText after the heading.\n\n```\n# not a heading\n```\n\n#tag text";

function drag(
  anchor: number,
  head: number,
  caret = doc.length,
  userEvent = "select.pointer",
) {
  const state = EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: [documentTree, headingDragStart],
  });
  const range = state.update({
    selection: EditorSelection.range(anchor, head),
    userEvent,
  }).state.selection.main;
  return [range.anchor, range.head];
}

const title = doc.indexOf("Title");
const after = doc.indexOf("after");

test("a drag from the start of a heading's text takes its hidden marks", () => {
  assert.deepEqual(drag(title, after), [0, after]);
  // Upward, ending at the start of the heading's text.
  assert.deepEqual(drag(after, title), [after, 0]);
});

test("a click, marks already shown, code and tags keep the drag as it was", () => {
  assert.deepEqual(drag(title, title), [title, title], "a click");
  assert.deepEqual(
    drag(title, after, 3),
    [title, after],
    "caret on the heading",
  );
  const code = doc.indexOf("not a heading");
  assert.deepEqual(drag(code, code + 5), [code, code + 5], "inside code");
  const tag = doc.indexOf("text", doc.indexOf("#tag"));
  assert.deepEqual(drag(tag, tag + 2), [tag, tag + 2], "a tag is no heading");
  assert.deepEqual(
    drag(title, after, doc.length, "select"),
    [title, after],
    "keyboard",
  );
});
