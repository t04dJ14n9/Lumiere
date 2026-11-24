import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { taskEdit, checklistEdit, runChecklist } from "./edits";
test("checkbox changes check the expected line and preserve quotes, labels and custom states", () => {
  const text = "> 1. [?] 🧠 task\n- [ ] second";
  const edit = taskEdit(text, 0, "> 1. [?] 🧠 task", true)!;
  assert.equal(
    EditorState.create({ doc: text })
      .update({ changes: edit })
      .newDoc.toString(),
    "> 1. [x] 🧠 task\n- [ ] second",
  );
  assert.equal(taskEdit(text, 0, "> 1. [ ] stale", true), undefined);
  assert.equal(taskEdit(text, 2, "missing", true), undefined);
  assert.equal(taskEdit("plain", 0, "plain", true), undefined);
});
test("checklist cycling preserves list identity and includes a final column-zero line, as Obsidian 1.15 does", () => {
  let state = EditorState.create({
    doc: "- item\nnext",
    selection: { anchor: 0, head: 7 },
  });
  state = state.update(checklistEdit(state, true)).state;
  assert.equal(state.doc.toString(), "- item\n- next");
  state = state.update(checklistEdit(state, true)).state;
  assert.equal(state.doc.toString(), "- [ ] item\n- [ ] next");
  state = state.update(checklistEdit(state, true)).state;
  assert.equal(state.doc.toString(), "- [x] item\n- [x] next");
  state = state.update(checklistEdit(state, true)).state;
  assert.equal(state.doc.toString(), "- item\n- next");
});

test("cycling a completed task without trailing text preserves the next line", () => {
  const state = EditorState.create({ doc: "- [x]\nnext" });
  assert.equal(
    state.update(checklistEdit(state, true)).newDoc.toString(),
    "- \nnext",
  );
});

test("toggling the checkbox status works as Obsidian's Cmd+L", () => {
  const toggle = (doc: string) => {
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
    });
    return state.update(checklistEdit(state, false)).newDoc.toString();
  };
  assert.equal(toggle("a"), "- [ ] a");
  assert.equal(toggle(""), "- [ ] ");
  assert.equal(toggle("- a"), "- [ ] a");
  assert.equal(toggle("1. a"), "1. [ ] a");
  assert.equal(toggle("- [ ] a"), "- [x] a");
  assert.equal(toggle("- [x] a"), "- [ ] a");
  assert.equal(toggle("> a"), "> - [ ] a");
  assert.equal(toggle("> - [ ] a"), "> - [x] a");
  assert.equal(toggle("\ta"), "\t- [ ] a");
  assert.equal(toggle("# a"), "- [ ] # a");
});

test("toggling on an empty line leaves the caret after the new box", () => {
  const state = EditorState.create({ doc: "" });
  const next = state.update(checklistEdit(state, false)).state;
  assert.equal(next.doc.toString(), "- [ ] ");
  assert.equal(next.selection.main.head, 6);
});

test("the checklist commands also refuse a caret at a table's end and a secondary caret in a row", () => {
  const table = "| a | b |\n| --- | --- |\n| c | d |";
  const doc = `${table}\n\nafter`;
  const initials = [
    EditorState.create({ doc, selection: { anchor: table.length } }),
    EditorState.create({
      doc,
      selection: EditorSelection.create(
        [
          EditorSelection.cursor(doc.indexOf("c")),
          EditorSelection.cursor(doc.indexOf("after")),
        ],
        1,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
  ];
  for (const cycle of [false, true]) {
    for (const initial of initials) {
      let state = initial;
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
      assert.equal(runChecklist(view, cycle), false);
      assert.equal(dispatched, false);
      assert.equal(state.doc.toString(), doc);
    }
  }
});

test("the checklist commands refuse a selection that spans a table", () => {
  const table = "| a | b |\n| --- | --- |\n| c | d |";
  const doc = `before\n\n${table}\n\nafter`;
  for (const cycle of [false, true]) {
    let state = EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
    });
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
    assert.equal(runChecklist(view, cycle), false);
    assert.equal(dispatched, false);
    assert.equal(state.doc.toString(), doc);
  }
});

// Obsidian 1.15.0 registers both checklist commands behind
// `if (!a.inTableCell)` (issue #693).
test("the checklist commands are refused inside a table cell and run outside one", () => {
  const table = "| a | b |\n| --- | --- |\n| c | d |";
  const viewAt = (doc: string, anchor: number) => {
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
  };
  for (const cycle of [false, true]) {
    const refused = viewAt(table, table.indexOf("c"));
    assert.equal(runChecklist(refused.view, cycle), false);
    assert.equal(refused.didDispatch(), false);
    assert.equal(refused.view.state.doc.toString(), table);

    const allowed = viewAt("item", 2);
    assert.equal(runChecklist(allowed.view, cycle), true);
    assert.equal(allowed.didDispatch(), true);
  }
});
