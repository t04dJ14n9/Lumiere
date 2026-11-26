import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import {
  BLOCK_RENDERER_KINDS,
  NO_BLOCK_WIDGET,
  RENDER_AFFECTING_FEATURE_IDS,
} from "../../shared/first-view";
import { blockIndex } from "./blocks";
import { documentTree } from "./document-tree";
import { endPendingBlocks, pendingBlocks } from "./pending-blocks";
import { blockRenderers } from "./registry";

const NOTE = [
  "Intro line.",
  "",
  "> [!warning] Careful",
  "> The body.",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "$$",
  "x^2",
  "$$",
  "",
  "```mermaid",
  "graph TD; A-->B",
  "```",
  "",
  "![[picture.png]]",
  "",
  "> a plain quote",
  "",
  "A paragraph with ![[inline.png]] inside.",
].join("\n");

const ALL = Object.values(BLOCK_RENDERER_KINDS);

function stateOf(kinds: readonly string[], ...more: unknown[]) {
  return EditorState.create({
    doc: NOTE,
    extensions: [
      documentTree,
      blockIndex,
      pendingBlocks(kinds),
      ...(more as never[]),
    ],
  });
}

const kindsOf = (state: EditorState) =>
  state.field(blockIndex).map((block) => block.kind);

test("blocks that await their renderers are held as empty shells, and others stay source", () => {
  const state = stateOf(ALL);
  assert.deepEqual(kindsOf(state), [
    "pending-callout",
    "pending-Table",
    "pending-math",
    "pending-diagram",
    "pending-embed",
  ]);
  const shell = state.field(blockIndex)[0]!;
  assert.ok(
    state.facet(blockRenderers)[0]!.widget(shell).estimatedHeight > 0,
    "the shell reserves the callout's estimated height",
  );
  // A feature that is off or not awaited leaves its source.
  assert.deepEqual(kindsOf(stateOf(["Table"])), ["pending-Table"]);
  assert.deepEqual(kindsOf(stateOf([])), []);
  assert.deepEqual(kindsOf(stateOf(["nonsense"])), []);
});

test("a shell gives way to its feature's renderer when it registers", () => {
  class Widget extends WidgetType {
    override toDOM(): HTMLElement {
      throw new Error("not drawn");
    }
  }
  const real = (kind: string, nodes: string[]) =>
    blockRenderers.of({
      kind,
      nodes,
      editing: "reveal",
      match: (node) => nodes.includes(node.name),
      widget: () => new Widget(),
    });
  const state = stateOf(
    ALL,
    real("Table", ["Table"]),
    real("callout", ["Blockquote"]),
  );
  // The shells of the kinds that have loaded are gone; the others stay.
  assert.deepEqual(kindsOf(state), [
    "callout",
    "Table",
    "pending-math",
    "pending-diagram",
    "pending-embed",
    "callout",
  ]);
});

test("once the features have loaded a block whose renderer never came shows its source", () => {
  const state = stateOf(ALL).update({
    effects: endPendingBlocks(),
  }).state;
  assert.deepEqual(kindsOf(state), []);
});

test("a math block that ends mid-line holds the whole line, as the formula does", () => {
  const doc = "$$\nx\n$$ trailing words\n\nAfter.";
  const state = EditorState.create({
    doc,
    extensions: [documentTree, blockIndex, pendingBlocks(["math"])],
  });
  const [block] = state.field(blockIndex);
  assert.equal(block!.to, doc.indexOf("\n\nAfter"));
});

test("every first-view feature that changes a block's look is awaited or says it draws no widget", () => {
  for (const id of RENDER_AFFECTING_FEATURE_IDS) {
    assert.ok(
      id in BLOCK_RENDERER_KINDS || NO_BLOCK_WIDGET.has(id),
      `${id} is neither held as a block nor listed as having no block widget`,
    );
    assert.equal(
      id in BLOCK_RENDERER_KINDS && NO_BLOCK_WIDGET.has(id),
      false,
      id,
    );
  }
});

test("frontmatter is held by the Properties skeleton, and by nothing once Properties is not awaited", () => {
  const doc = "---\ntitle: A\n---\n\n# Heading\n";
  const held = (kinds: string[]) =>
    EditorState.create({
      doc,
      extensions: [documentTree, blockIndex, pendingBlocks(kinds)],
    })
      .field(blockIndex)
      .map((block) => block.kind);
  assert.deepEqual(held(["properties"]), ["frontmatter-placeholder"]);
  // Properties off, or shown as source or hidden: the fence is not replaced.
  assert.deepEqual(held(["Table"]), []);
  const ended = EditorState.create({
    doc,
    extensions: [documentTree, blockIndex, pendingBlocks(["properties"])],
  }).update({ effects: endPendingBlocks() }).state;
  assert.deepEqual(kindsOf(ended), []);
});
