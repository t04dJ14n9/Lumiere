import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { documentTree } from "../../../src/plugins/livePreview/document-tree";
import { inlineRenderers } from "../../../src/plugins/livePreview/registry";
import { inlineDecorations } from "../../../src/plugins/livePreview/inline";
import { replaceDocumentTree } from "../../../src/plugins/livePreview/api";
import { parseMarkdown } from "../../../src/markdown/dialect";
import { markMathSource } from "../../../src/plugins/math/source-marks";

const mathSource = inlineRenderers.of({
  nodes: ["InlineMath", "MathBlock"],
  decorate(node, cx) {
    if (cx.revealed(node.from, node.to)) {
      markMathSource(cx, node);
    }
  },
});

function marks(doc: string, anchor: number, screen: number) {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [documentTree, mathSource],
  });
  state = state.update({
    effects: replaceDocumentTree.of(parseMarkdown(state.doc)),
  }).state;
  const found: { text: string; cls: string }[] = [];
  inlineDecorations(state, [{ from: 0, to: screen }]).between(
    0,
    doc.length,
    (from, to, value) => {
      const cls = String(value.spec.class ?? "");
      if (cls.startsWith("md-math")) {
        found.push({ text: doc.slice(from, to), cls });
      }
    },
  );
  return found;
}

test("an unclosed $$ highlights only the lines on screen", () => {
  const line = "x^2 + \\alpha_1 = 3.5 (y)";
  const note = (lines: number) =>
    `$$\n${Array.from({ length: lines }, () => line).join("\n")}`;
  const screen = 40 * (line.length + 1);
  const short = marks(note(1_000), 3, screen);
  const long = marks(note(10_000), 3, screen);
  // Highlighting every line after the `$$` cost each keystroke the rest of
  // the note.
  assert.equal(long.length, short.length);
  assert.ok(short.length < 1_000, `${short.length} marks for one screen`);
  const body = long.find((mark) => mark.cls === "md-math");
  assert.ok(body && body.text.length <= screen + line.length);
});

test("a closed formula on screen is highlighted as a whole", () => {
  const doc = "$$\n\\frac{a}{b}\n$$\n";
  const found = marks(doc, 4, doc.length);
  assert.deepEqual(
    found.map((mark) => `${mark.cls}:${mark.text}`).sort(),
    [
      "md-math md-math-delimiter:$$",
      "md-math:\n\\frac{a}{b}\n",
      "md-math-command:\\frac",
      "md-math-bracket:{",
      "md-math-variable:a",
      "md-math-bracket:}",
      "md-math-bracket:{",
      "md-math-variable:b",
      "md-math-bracket:}",
      "md-math md-math-delimiter:$$",
    ].sort(),
  );
});

test("inline math keeps its single-dollar delimiters", () => {
  const doc = "a $x_1$ b";
  const found = marks(doc, 4, doc.length);
  assert.deepEqual(
    found.map((mark) => `${mark.cls}:${mark.text}`).sort(),
    [
      "md-math md-math-delimiter:$",
      "md-math:x_1",
      "md-math-variable:x",
      "md-math-command:_",
      "md-math-number:1",
      "md-math md-math-delimiter:$",
    ].sort(),
  );
});
