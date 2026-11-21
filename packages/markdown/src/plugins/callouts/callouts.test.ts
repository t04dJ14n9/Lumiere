import test from "node:test";
import assert from "node:assert/strict";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertCallout, insertCalloutCommand, isCallout } from "./edit";

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

// Obsidian's condition for the template branch is a collapsed selection with
// only whitespace before the caret (`!sameCursor(from, to) ||
// line.substring(0, ch).trim()` takes the wrapping branch), so the template
// goes in at the caret, not at the line start, and a whitespace-only line
// keeps its whitespace.
test("Insert Callout inserts the template at a caret that only whitespace precedes", () => {
  const template = "\n> [!NOTE] Title\n> Contents\n";
  const indented = applyInsertCallout("  one", 2);
  assert.equal(indented.doc.toString(), `  ${template}one`);
  assert.equal(
    indented.sliceDoc(indented.selection.main.from, indented.selection.main.to),
    "NOTE",
  );
  assert.equal(indented.selection.main.from, 2 + "\n> [!".length);

  const blank = applyInsertCallout("  \nafter", 2);
  assert.equal(blank.doc.toString(), `  ${template}\nafter`);
  assert.equal(
    blank.sliceDoc(blank.selection.main.from, blank.selection.main.to),
    "NOTE",
  );
});

test("Insert Callout wraps when text precedes the caret or the selection is not empty", () => {
  assert.equal(applyInsertCallout("one", 3).doc.toString(), "> [!NOTE]\n> one");
  assert.equal(
    applyInsertCallout("  one", 3).doc.toString(),
    "> [!NOTE]\n>   one",
  );
  assert.equal(
    applyInsertCallout("one", 0, 1).doc.toString(),
    "> [!NOTE]\n> one",
  );
});

test("Insert Callout includes the line a selection ends at the start of, as Obsidian 1.15 does", () => {
  const next = applyInsertCallout("one\ntwo\nbelow", 0, 4);
  const { from, to } = next.selection.main;
  assert.equal(next.doc.toString(), "> [!NOTE]\n> one\n> two\n\nbelow");
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

/** A view that records whether the command dispatched an edit. */
function fakeView(doc: string, anchor: number) {
  let state = EditorState.create({ doc, selection: { anchor } });
  let dispatched = false;
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      dispatched = true;
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  return { view, didDispatch: () => dispatched };
}

// Obsidian 1.15.0 registers Insert Callout behind `if (!a.inTableCell)`
// (issue #693).
test("Insert Callout is refused inside a table cell and runs outside one", () => {
  const table = "| a | b |\n| --- | --- |\n| c | d |";
  const refused = fakeView(table, table.indexOf("c"));
  assert.equal(insertCalloutCommand(refused.view), false);
  assert.equal(refused.didDispatch(), false);
  assert.equal(refused.view.state.doc.toString(), table);

  const allowed = fakeView(`${table}\n\nafter`, `${table}\n\nafter`.length);
  assert.equal(insertCalloutCommand(allowed.view), true);
  assert.equal(allowed.didDispatch(), true);
});
