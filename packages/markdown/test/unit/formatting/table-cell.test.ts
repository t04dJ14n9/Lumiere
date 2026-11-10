import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { isInTableCell } from "../../../src/plugins/formatting/table-cell";
import { formattingCommands } from "../../../src/plugins/formatting/webview";

const TABLE = "| a | b |\n| --- | --- |\n| c | d |";
const WITH_TEXT = `${TABLE}\n\nafter text`;

// Obsidian refuses exactly these block commands inside a table cell. The
// formatting layer owns the list, quote and code-block ones; the checklist and
// callout commands live in the tasks and callouts plugins.
const REFUSED = [
  "editor:toggle-bullet-list",
  "editor:toggle-numbered-list",
  "editor:toggle-blockquote",
  "editor:insert-codeblock",
];

function state(doc: string, caret: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: caret } });
}

/** A view that just records whether a command dispatched an edit. */
function fakeView(initial: EditorState): {
  view: EditorView;
  dispatched: () => boolean;
} {
  let current = initial;
  let didDispatch = false;
  const view = {
    get state() {
      return current;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      didDispatch = true;
      current = current.update(spec).state;
    },
  } as unknown as EditorView;
  return { view, dispatched: () => didDispatch };
}

test("isInTableCell is true anywhere on a table row and false outside it", () => {
  // A header cell, a body cell and the separator row are all table positions.
  assert.equal(isInTableCell(state(TABLE, TABLE.indexOf("a"))), true);
  assert.equal(isInTableCell(state(TABLE, TABLE.indexOf("c"))), true);
  assert.equal(isInTableCell(state(TABLE, TABLE.indexOf("---"))), true);
  // A caret in a paragraph after the table and in plain text are not.
  assert.equal(
    isInTableCell(state(WITH_TEXT, WITH_TEXT.indexOf("after"))),
    false,
  );
  assert.equal(isInTableCell(state("hello world", 3)), false);
  assert.equal(isInTableCell(state("", 0)), false);
});

test("isInTableCell accepts an explicit position overriding the caret", () => {
  const outside = state(WITH_TEXT, WITH_TEXT.indexOf("after"));
  assert.equal(isInTableCell(outside), false);
  assert.equal(isInTableCell(outside, TABLE.indexOf("c")), true);
});

test("the list, quote and code-block commands refuse inside a table cell", () => {
  const commands = formattingCommands();
  const caret = TABLE.indexOf("c");
  for (const id of REFUSED) {
    const { view, dispatched } = fakeView(state(TABLE, caret));
    assert.equal(commands.get(id)!(view), false, `${id} returns false`);
    assert.equal(dispatched(), false, `${id} dispatches no edit`);
  }
});

test("the same commands still run outside a table cell", () => {
  const commands = formattingCommands();
  for (const id of REFUSED) {
    const { view, dispatched } = fakeView(state("hello", 3));
    assert.equal(commands.get(id)!(view), true, `${id} returns true`);
    assert.equal(dispatched(), true, `${id} dispatches its edit`);
  }
});

test("the guard matches Obsidian's list: headings are not refused", () => {
  const commands = formattingCommands();
  const { view, dispatched } = fakeView(state(TABLE, TABLE.indexOf("c")));
  assert.notEqual(commands.get("editor:set-heading-2")!(view), false);
  assert.equal(dispatched(), true);
});
