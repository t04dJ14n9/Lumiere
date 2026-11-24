import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdownLanguageSupport } from "../../../src/markdown/dialect";
import {
  continueLine,
  continueList,
} from "../../../src/plugins/smartLists/commands";

type Command = typeof continueList;

/** Runs `command` with the caret at the end of `doc`, read-only or writable. */
function run(doc: string, readOnly: boolean, command: Command) {
  let state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [
      markdownLanguageSupport(),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ],
  });
  let dispatched = false;
  const handled = command({
    state,
    dispatch: (transaction) => {
      dispatched = true;
      state = transaction.state;
    },
  });
  return { handled, dispatched, doc: state.doc.toString() };
}

test("Enter continues a list only in a writable editor", () => {
  const writable = run("- item", false, continueList);
  assert.equal(writable.handled, true);
  assert.equal(writable.dispatched, true);
  assert.equal(writable.doc, "- item\n- ");

  const readOnly = run("- item", true, continueList);
  assert.equal(readOnly.handled, false);
  assert.equal(readOnly.dispatched, false);
  assert.equal(readOnly.doc, "- item");
});

test("Shift+Enter continues a list line only in a writable editor", () => {
  const writable = run("- item", false, continueLine);
  assert.equal(writable.dispatched, true);

  const readOnly = run("- item", true, continueLine);
  assert.equal(readOnly.handled, false);
  assert.equal(readOnly.dispatched, false);
  assert.equal(readOnly.doc, "- item");
});
