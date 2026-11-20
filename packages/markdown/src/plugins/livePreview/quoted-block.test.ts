import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { blockIndex } from "./blocks";
import { blockRenderers } from "./registry";
import { documentTree } from "./document-tree";
import { unquotedBlock } from "../../markdown/quoted-block";
import { createRenderer } from "../../markdown/html";

const { renderMarkdown } = createRenderer();

function mathBlocks(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      documentTree,
      blockIndex,
      blockRenderers.of({
        kind: "math",
        editing: "reveal",
        match: (node) => node.name === "MathBlock",
        widget: () => {
          throw new Error("Not mounted in a unit test");
        },
      }),
    ],
  });
  return state.field(blockIndex);
}

test("display math inside a plain blockquote renders without the > markers", () => {
  const [block] = mathBlocks("> quote\n> $$\n> a + b\n> $$\n> after");
  assert.ok(block);
  assert.equal(block.source, "$$\n> a + b\n> $$");
  const html = renderMarkdown(block.markdown ?? block.source);
  assert.match(html, /data-math="a%20%2B%20b"/);
});

test("display math outside a quote renders its own text, > included", () => {
  const [block] = mathBlocks("$$\n> 0\n$$");
  assert.ok(block);
  assert.equal(block.markdown, undefined);
});

test("only as many markers as the block's first line has are removed", () => {
  assert.equal(unquotedBlock("$$\n> > x > 0\n> > $$", "> > "), "$$\nx > 0\n$$");
  assert.equal(unquotedBlock("$$\n> > x\n> $$", "> "), "$$\n> x\n$$");
  assert.equal(unquotedBlock("$$\nlazy\n> $$", ">"), "$$\nlazy\n$$");
});

test("a block that does not start after a quote marker is unchanged", () => {
  const source = "$$\n> x\n$$";
  assert.equal(unquotedBlock(source, ""), source);
  assert.equal(unquotedBlock(source, "- "), source);
});
