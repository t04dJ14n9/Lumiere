import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import { blockIndex } from "../../../src/plugins/livePreview/blocks";
import { documentTree } from "../../../src/plugins/livePreview/document-tree";
import { blockRenderers } from "../../../src/plugins/livePreview/registry";
import { markdownParser } from "../../../src/markdown/dialect";
import { matchesEditableTable } from "../../../src/plugins/tables/renderer-match";

class UnmountedWidget extends WidgetType {
  toDOM(): HTMLElement {
    throw new Error("Not mounted");
  }
}

const tableBlocks = (doc: string) =>
  EditorState.create({
    doc,
    extensions: [
      documentTree,
      blockIndex,
      blockRenderers.of({
        kind: "Table",
        nodes: ["Table"],
        editing: "widget",
        match: matchesEditableTable,
        widget: () => new UnmountedWidget(),
      }),
    ],
  })
    .field(blockIndex)
    .map((block) => block.source);

const parsedTables = (doc: string) => {
  const found: string[] = [];
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (node.name === "Table") {
        found.push(doc.slice(node.from, node.to));
      }
    },
  });
  return found;
};

test("a table inside a quote is left as text instead of crashing the table editor", () => {
  for (const doc of [
    "> | a | b |\n> | - | - |\n> | c | d |\n",
    "> a | b\n> --- | ---\n> c | d\n",
  ]) {
    // The parser does report a table here; its source keeps the "> " markers.
    assert.ok(parsedTables(doc).length > 0, doc);
    assert.deepEqual(tableBlocks(doc), [], doc);
  }
});

test("an ordinary table still renders as the table editor", () => {
  assert.deepEqual(tableBlocks("| a | b |\n| - | - |\n| c | d |\n"), [
    "| a | b |\n| - | - |\n| c | d |",
  ]);
});
