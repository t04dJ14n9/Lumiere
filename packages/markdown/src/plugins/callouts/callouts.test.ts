import test from "node:test";
import assert from "node:assert/strict";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { insertCallout, isCallout } from "./edit";

const applyInsertCallout = (doc: string, anchor: number, head = anchor) => {
  const state = EditorState.create({ doc, selection: { anchor, head } });
  return state.update(insertCallout(state)).state;
};

// Expected notes are Obsidian's, measured in a throwaway vault (2026-10-17).
test("Insert Callout quotes the selected lines, apart from the text around, with its type selected", () => {
  const insert = (doc: string, anchor: number, head = anchor) => {
    const next = applyInsertCallout(doc, anchor, head);
    const { from, to } = next.selection.main;
    return `${next.doc.toString()} [${next.sliceDoc(from, to)}]`;
  };
  assert.equal(insert("one\ntwo", 0, 7), "> [!NOTE]\n> one\n> two [NOTE]");
  assert.equal(
    insert("above\none\ntwo\nbelow", 6, 13),
    "above\n\n> [!NOTE]\n> one\n> two\n\nbelow [NOTE]",
  );
  assert.equal(insert("text\n", 2), "> [!NOTE]\n> text\n [NOTE]");
  assert.equal(insert("", 0), "\n> [!NOTE] Title\n> Contents\n [NOTE]");
  assert.equal(
    insert("above\n\nbelow", 6),
    "above\n\n> [!NOTE] Title\n> Contents\n\nbelow [NOTE]",
  );
  assert.equal(isCallout("> [!NOTE]\n> one"), true);
  assert.equal(isCallout("> ordinary quote"), false);
  assert.equal(isCallout("> [!warning]- Custom"), true);
});

// Obsidian 1.15.0's shipped collapsed-caret branch inserts the
// Title/Contents template at the caret (issue #691). Its leading newline
// leaves the line below it untouched.
test("Insert Callout inserts the Title/Contents template above a non-empty line at column 0", () => {
  const first = applyInsertCallout("one\ntwo", 0);
  assert.equal(first.doc.toString(), "\n> [!NOTE] Title\n> Contents\none\ntwo");
  assert.equal(first.selection.main.anchor, "\n> [!".length);
  assert.equal(first.selection.main.head, "\n> [!NOTE".length);
  assert.equal(
    first.sliceDoc(first.selection.main.from, first.selection.main.to),
    "NOTE",
  );
  assert.equal(
    applyInsertCallout("above\none\ntwo", 6).doc.toString(),
    "above\n\n> [!NOTE] Title\n> Contents\none\ntwo",
  );
});

test("Insert Callout keeps a selection ending at column zero on the previous line", () => {
  const next = applyInsertCallout("one\ntwo\nbelow", 0, 4);
  const { from, to } = next.selection.main;
  assert.equal(next.doc.toString(), "> [!NOTE]\n> one\n\ntwo\nbelow");
  assert.equal(next.sliceDoc(from, to), "NOTE");
});

test("Insert Callout inserts the template above an existing callout", () => {
  const doc = "> [!NOTE]\n> body\nafter";
  const atTitle = applyInsertCallout(doc, 0);
  assert.equal(atTitle.doc.toString(), "\n> [!NOTE] Title\n> Contents\n" + doc);
  assert.equal(
    atTitle.sliceDoc(atTitle.selection.main.from, atTitle.selection.main.to),
    "NOTE",
  );

  // The one trailing newline leaves an adjacent `>` line in the same
  // blockquote, as the shipped insertion does. Rendering is out of scope here.
  const atBody = applyInsertCallout(doc, doc.indexOf("> body"));
  assert.equal(
    atBody.doc.toString(),
    "> [!NOTE]\n\n> [!NOTE] Title\n> Contents\n> body\nafter",
  );
  assert.equal(
    atBody.sliceDoc(atBody.selection.main.from, atBody.selection.main.to),
    "NOTE",
  );
});

test("one undo removes the column-0 callout template", () => {
  let state = EditorState.create({
    doc: "one\ntwo",
    selection: { anchor: 0 },
    extensions: [history()],
  });
  const target = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  };
  target.dispatch(state.update(insertCallout(state)));
  assert.equal(state.doc.toString(), "\n> [!NOTE] Title\n> Contents\none\ntwo");
  assert.equal(undo(target), true);
  assert.equal(state.doc.toString(), "one\ntwo");
});

// Obsidian 1.15.0's callout syntax, read from its app.js with REA
// (2026-11-07): the type is any text but `]`, a `|` starts metadata, and a
// space or the line's end follows the `]` and fold sign.
test("a callout's type is any text but ], as in Obsidian", () => {
  assert.equal(isCallout("> [!note|wide] Title\n> body"), true);
  assert.equal(isCallout("> [!笔记]\n> 内容"), true);
  assert.equal(isCallout("> [!my type]- Folded"), true);
  assert.equal(isCallout("> [!note]text"), false);
  assert.equal(isCallout("> [!info](https://example.com)"), false);
});
