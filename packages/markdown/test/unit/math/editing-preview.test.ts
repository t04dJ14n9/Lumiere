import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, Text } from "@codemirror/state";
import { MarkdownInline } from "../../../src/webview/ui/inline-widget";
import { documentTree } from "../../../src/plugins/livePreview/document-tree";
import { inlineRenderers } from "../../../src/plugins/livePreview/registry";
import { inlineDecorations } from "../../../src/plugins/livePreview/inline";
import {
  editorFocus,
  setEditorFocus,
} from "../../../src/plugins/livePreview/editor-focus";
import type { RenderService } from "../../../src/plugins/render/api";
import {
  blockPreviewPlacement,
  closingEnd,
  decorateMath,
} from "../../../src/plugins/math/editing-preview";

test("a display formula's preview goes below it when its $$ have their lines to themselves, inline otherwise, as in Obsidian", () => {
  for (const [doc, placement] of [
    ["$$\nx\n$$", "block"],
    ["$$x^2$$", "block"],
    ["  $$\n  x\n  $$  ", "block"],
    // Lumiere renders quoted display math as a block.
    ["> $$\n> x\n> $$", "block"],
    ["$$\nx\n$$ is famous", "inline"],
    ["- $$\n  x\n  $$", "inline"],
    ["$$\nx", "none"],
    ["$$x", "none"],
  ] as const) {
    const text = Text.of(doc.split("\n"));
    const from = doc.indexOf("$$");
    assert.equal(
      blockPreviewPlacement(text, { from, source: doc.slice(from) }),
      placement,
      doc,
    );
  }
});

test("a display formula closes at the first $$ after its opening line", () => {
  assert.equal(closingEnd("$$x$$"), 5);
  assert.equal(closingEnd("$$\nx\n$$ and $$y$$"), 7);
  assert.equal(closingEnd("$$\nx"), -1);
});

const render = {} as RenderService;
const math = inlineRenderers.of({
  nodes: ["InlineMath", "MathBlock"],
  decorate: (node, cx) => decorateMath(cx, node, render),
});

/** Where the inline decorations put formulas: replaced, or a preview after. */
function formulas(doc: string, selection: EditorSelection, hasFocus: boolean) {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [documentTree, editorFocus, math],
  }).update({ effects: setEditorFocus.of(hasFocus) }).state;
  const found: string[] = [];
  inlineDecorations(state, [{ from: 0, to: doc.length }]).between(
    0,
    doc.length,
    (from, to, value) => {
      const widget = value.spec.widget as unknown;
      if (widget instanceof MarkdownInline) {
        found.push(
          from === to
            ? `preview ${widget.source} at ${from}`
            : `rendered ${widget.source}`,
        );
      }
    },
  );
  return found;
}

test("inline $$ math, revealed while focused, is typeset again just after its closing $$", () => {
  const doc = "an $$x^2$$ b";
  const inside = EditorSelection.single(6);
  assert.deepEqual(formulas(doc, inside, true), ["preview $$x^2$$ at 10"]);
  assert.deepEqual(formulas(doc, inside, false), ["rendered $$x^2$$"]);
  assert.deepEqual(formulas(doc, EditorSelection.single(0), true), [
    "rendered $$x^2$$",
  ]);
});

test("inline $ math reveals without focus and has no preview", () => {
  const doc = "an $x^2$ b";
  for (const hasFocus of [true, false]) {
    assert.deepEqual(formulas(doc, EditorSelection.single(5), hasFocus), []);
  }
  assert.deepEqual(formulas(doc, EditorSelection.single(0), false), [
    "rendered $x^2$",
  ]);
});

test("display math followed by text on its closing line is previewed inline, before that text", () => {
  const doc = "$$\nx\n$$ is famous";
  assert.deepEqual(formulas(doc, EditorSelection.single(3), true), [
    "preview $$\nx\n$$ at 7",
  ]);
  // Its later lines quoted, the preview could not map a click: none.
  assert.deepEqual(
    formulas("> $$\n> x\n> $$ is famous", EditorSelection.single(5), true),
    [],
  );
  assert.deepEqual(formulas(doc, EditorSelection.single(3), false), []);
});

test("a click on an inline preview selects the formula before it, without its $$", () => {
  const doc = "an $$x^2$$ b";
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(6),
    extensions: [documentTree, editorFocus, math],
  }).update({ effects: setEditorFocus.of(true) }).state;
  let preview: { at: number; select: (source: string) => unknown } | undefined;
  inlineDecorations(state, [{ from: 0, to: doc.length }]).between(
    0,
    doc.length,
    (from, to, value) => {
      const found = value.spec.widget as unknown;
      if (found instanceof MarkdownInline && from === to) {
        // The click is private to the widget; it is what a click runs.
        const click = (
          found as unknown as {
            click: { select: (source: string) => unknown };
          }
        ).click;
        preview = { at: from, select: click.select };
      }
    },
  );
  assert.ok(preview);
  const span = preview.select("$$x^2$$") as { from: number; to: number };
  assert.equal(doc.slice(preview.at + span.from, preview.at + span.to), "x^2");
});
