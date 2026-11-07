import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { insertFootnote } from "../../../src/plugins/footnotes/edit";

function inserted(doc: string, caret: number) {
  const state = EditorState.create({ doc, selection: { anchor: caret } });
  const spec = insertFootnote(state);
  const after = state.update(spec as TransactionSpec).state;
  return {
    doc: after.doc.toString(),
    caret: after.selection.main.head,
    label: spec.label,
  };
}

// Obsidian 1.15.0's Insert footnote, read from its app.js with REA
// (2026-11-07): the next number is one more than the highest numbered one.
test("a new footnote takes one more than the highest number, not a gap", () => {
  const doc = "A[^1] b[^3] c[^note]\n\n[^1]: one\n[^3]: three\n[^note]: named";
  assert.equal(inserted(doc, 1).label, "4");
  assert.equal(inserted("Plain text.", 5).label, "1");
  assert.equal(
    inserted("Inline^[aside] only.\n\n[^note]: named", 0).label,
    "1",
    "inline and named footnotes do not count",
  );
});

test("the reference goes at the caret and the definition at the end, a blank line before it", () => {
  assert.deepEqual(inserted("Some text", 4), {
    doc: "Some[^1] text\n\n[^1]: \n",
    caret: 8,
    label: "1",
  });
  assert.equal(
    inserted("Some text\n\n", 4).doc,
    "Some[^1] text\n\n[^1]: \n",
    "existing blank lines at the end are reused",
  );
});
