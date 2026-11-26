import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { blockIndex } from "../../../src/plugins/livePreview/blocks";
import { documentTree } from "../../../src/plugins/livePreview/document-tree";
import { pendingBlocks } from "../../../src/plugins/livePreview/pending-blocks";
import { isCallout } from "../../../src/plugins/callouts/edit";

const kindsOf = (state: EditorState) =>
  state.field(blockIndex).map((block) => block.kind);

test("the shells match the blocks the features' renderers match", () => {
  // The callout renderer's own rule: the quote that is a callout, not the plain one.
  for (const [source, expected] of [
    ["> [!note] Title\n> body", true],
    ["> [!note|wide]+\n> body", true],
    ["> [!笔记]\n> body", true],
    ["> [!note\n> body", false],
    ["> a plain quote", false],
    ["> [ ] not a callout", false],
  ] as const) {
    assert.equal(isCallout(source), expected, source);
    const state = EditorState.create({
      doc: `Text\n\n${source}\n`,
      extensions: [documentTree, blockIndex, pendingBlocks(["callout"])],
    });
    assert.equal(kindsOf(state).length === 1, expected, source);
  }
});
