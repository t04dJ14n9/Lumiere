import assert from "node:assert/strict";
import test from "node:test";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { markdownLanguageSupport } from "../../markdown/dialect";
import { headingLines } from "./headings";

function gutterClasses(doc: string): { line: number; cls: string }[] {
  const created = EditorState.create({
    doc,
    extensions: [markdownLanguageSupport()],
  });
  // A new state holds the tree parsed within the creation budget, which a
  // busy machine can end before the last line. Finish the parse, then take
  // a state whose syntax tree is the finished one: `headingLines` reads it.
  assert.ok(ensureSyntaxTree(created, doc.length, 5000));
  const state = created.update({}).state;
  const found: { line: number; cls: string }[] = [];
  headingLines(state).between(0, doc.length, (from, _to, marker) => {
    found.push({
      line: state.doc.lineAt(from).number,
      cls: marker.elementClass,
    });
  });
  return found;
}

test("a heading's number on line 1 is marked as the first line, so it gets no padding above", () => {
  assert.deepEqual(gutterClasses("# Title\n\ntext\n\n## Section"), [
    { line: 1, cls: "md-h1-gutter is-first-line" },
    { line: 5, cls: "md-h2-gutter" },
  ]);
});

test("a note that starts with text marks no line as the first heading", () => {
  assert.deepEqual(gutterClasses("text\n\n# Title"), [
    { line: 3, cls: "md-h1-gutter" },
  ]);
});
