import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { foldEffect, foldState } from "@codemirror/language";
import { blockIndex } from "./blocks";
import { blockRenderers } from "./registry";
import { documentTree } from "./document-tree";
import {
  renderedWidgets,
  revealedSourceBlocks,
  foldedRanges,
  verticalBlock,
} from "./motion";

test("widget motion queries exclude reveal renderers and source overrides but retain tables under visual selections", () => {
  const source =
    "before\n\n| a | b |\n|---|---|\n| c | d |\n\n```\nx\n```\n\nafter";
  const state = (showSource = false) =>
    EditorState.create({
      doc: source,
      selection: { anchor: 0, head: source.length },
      extensions: [
        documentTree,
        blockIndex,
        blockRenderers.of({
          kind: "Table",
          editing: "widget",
          match: (node) => node.name === "Table",
          showSource: () => showSource,
          widget: () => {
            throw new Error("Not mounted");
          },
        }),
        blockRenderers.of({
          kind: "code",
          editing: "reveal",
          match: (node) => node.name === "FencedCode",
          widget: () => {
            throw new Error("Not mounted");
          },
        }),
      ],
    });
  assert.deepEqual(
    renderedWidgets(state(), 0, source.length).map((block) => block.kind),
    ["Table"],
  );
  assert.deepEqual(renderedWidgets(state(), 0, 6), []);
  assert.deepEqual(renderedWidgets(state(true), 0, source.length), []);
  assert.deepEqual(
    renderedWidgets(EditorState.create({ doc: source }), 0, source.length),
    [],
  );
});

test("revealed source queries include a fence only while its source is showing", () => {
  const source = "before\n\n```mermaid\nflowchart LR\nA --> B\n```\n\nafter";
  const state = (anchor: number) =>
    EditorState.create({
      doc: source,
      selection: { anchor },
      extensions: [
        documentTree,
        blockIndex,
        blockRenderers.of({
          kind: "diagram",
          editing: "reveal",
          match: (node) => node.name === "FencedCode",
          widget: () => {
            throw new Error("Not mounted");
          },
        }),
      ],
    });
  assert.deepEqual(revealedSourceBlocks(state(0), 0, source.length), []);
  const shown = state(source.lastIndexOf("```"));
  assert.deepEqual(
    revealedSourceBlocks(shown, 0, source.length).map((block) => block.kind),
    ["diagram"],
  );
  assert.deepEqual(renderedWidgets(shown, 0, source.length), []);
});

test("a folded reveal block stays in the source query because the motion gate owns folds", () => {
  const source = "# Folded\n```mermaid\nflowchart LR\nA --> B\n```\n\n# After";
  const state = EditorState.create({
    doc: source,
    selection: { anchor: 0, head: source.length },
    extensions: [
      documentTree,
      blockIndex,
      foldState,
      blockRenderers.of({
        kind: "diagram",
        editing: "reveal",
        match: (node) => node.name === "FencedCode",
        widget: () => {
          throw new Error("Not mounted");
        },
      }),
    ],
  });
  const folded = state.update({
    effects: foldEffect.of({ from: 8, to: source.indexOf("\n\n# After") }),
  }).state;
  assert.deepEqual(
    revealedSourceBlocks(folded, 0, source.length).map((block) => block.kind),
    ["diagram"],
  );
});

test("a table hidden inside a collapsed heading is absent from the widget motion query", () => {
  const source = "# Folded\n| a | b |\n|---|---|\n| c | d |\n\n# After";
  const state = EditorState.create({
    doc: source,
    extensions: [
      documentTree,
      blockIndex,
      foldState,
      blockRenderers.of({
        kind: "Table",
        editing: "widget",
        match: (node) => node.name === "Table",
        widget() {
          throw new Error("Not mounted");
        },
      }),
    ],
  });
  assert.equal(renderedWidgets(state, 0, source.length).length, 1);
  const folded = state.update({
    effects: foldEffect.of({ from: 8, to: source.indexOf("\n# After") }),
  }).state;
  assert.deepEqual(renderedWidgets(folded, 0, source.length), []);
  assert.equal(verticalBlock(folded, 1), undefined);
  assert.deepEqual(foldedRanges(folded), [
    { from: 8, to: source.indexOf("\n# After") },
  ]);
});

test("nested folds expose one disjoint span without hiding a separate visible table", () => {
  const source = "# Folded\n## Inner\ntext\n\n# After\n\n| a | b |\n|---|---|";
  const state = EditorState.create({
    doc: source,
    extensions: [
      documentTree,
      blockIndex,
      foldState,
      blockRenderers.of({
        kind: "Table",
        editing: "widget",
        match: (node) => node.name === "Table",
        widget() {
          throw new Error("Not mounted");
        },
      }),
    ],
  });
  const to = source.indexOf("\n\n# After");
  const folded = state.update({
    effects: [foldEffect.of({ from: 8, to }), foldEffect.of({ from: 17, to })],
  }).state;
  assert.deepEqual(foldedRanges(folded), [{ from: 8, to }]);
  assert.equal(renderedWidgets(folded, 0, source.length).length, 1);
});
