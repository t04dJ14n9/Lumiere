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

test("labels too large for exact arithmetic never repeat a label or print as an exponent", () => {
  const definition = (label: string) =>
    `Body[^${label}].\n\n[^${label}]: Keep.`;
  // 2^53 plus one rounds back to 2^53; 1e21 prints as "1e+21"; 400 digits
  // parse to Infinity. Each falls back to the first unused number.
  for (const label of [
    "9007199254740991",
    "9007199254740992",
    "1000000000000000000000",
    "9".repeat(400),
  ]) {
    assert.equal(inserted(definition(label), 0).label, "1", label);
  }
  assert.equal(
    inserted(
      "A[^1] b[^9007199254740992]\n\n[^1]: one\n[^9007199254740992]: big",
      0,
    ).label,
    "2",
  );
  assert.equal(
    inserted(definition("9007199254740990"), 0).label,
    "9007199254740991",
    "the largest safe successor is still one more than the highest",
  );
});
