import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { parseMarkdown, markdownParser } from "../../markdown/dialect";
import { blockIndex } from "./blocks";
import { documentTree } from "./document-tree";
import { blockRenderers } from "./registry";
import {
  completeFrontmatter,
  frontmatterPlaceholderHeight,
  frontmatterPlaceholderRenderer,
} from "./frontmatter-placeholder";

/** Tall fence past the 10 KB first-paint band (synthetic; no vault fixtures). */
const longFence = `---\n${"x: y\n".repeat(4000)}---\n\n# Heading\n\nbody\n`;

function frontmatterNode(
  tree: ReturnType<typeof parseMarkdown>,
): SyntaxNodeRef {
  let found: SyntaxNodeRef | undefined;
  tree.iterate({
    enter(node) {
      if (node.name === "Frontmatter") {
        // iterate's SyntaxNodeRef is only valid during the callback.
        found = node.node;
        return false;
      }
    },
  });
  assert.ok(found, "expected a Frontmatter node");
  return found!;
}

test("completeFrontmatter rejects a truncated first-paint Frontmatter node", () => {
  assert.ok(longFence.length > 20_000);
  const state = EditorState.create({ doc: longFence });
  const truncated = markdownParser.parse(longFence.slice(0, 10_000));
  const node = frontmatterNode(truncated);
  assert.ok(node.to < 15_000);
  assert.equal(completeFrontmatter(state, node), false);
});

test("completeFrontmatter accepts a full-document Frontmatter fence", () => {
  const state = EditorState.create({ doc: longFence });
  const node = frontmatterNode(parseMarkdown(state.doc));
  assert.equal(completeFrontmatter(state, node), true);
});

test("placeholder indexes Frontmatter until a properties renderer registers", () => {
  const doc = "---\ntitle: hi\n---\n\n# Heading\n";
  const placeholder = frontmatterPlaceholderRenderer();
  const state = EditorState.create({
    doc,
    extensions: [documentTree, blockIndex, blockRenderers.of(placeholder)],
  });
  assert.deepEqual(
    state.field(blockIndex).map((block) => block.kind),
    ["frontmatter-placeholder"],
  );

  class FakeProperties extends WidgetType {
    override toDOM(): HTMLElement {
      return document.createElement("div");
    }
  }
  const withProperties = EditorState.create({
    doc,
    extensions: [
      documentTree,
      blockIndex,
      blockRenderers.of(placeholder),
      blockRenderers.of({
        kind: "properties",
        nodes: ["Frontmatter"],
        editing: "widget",
        match: (node) => node.name === "Frontmatter",
        widget: () => new FakeProperties(),
      }),
    ],
  });
  assert.deepEqual(
    withProperties.field(blockIndex).map((block) => block.kind),
    ["properties"],
  );
});

test("placeholder reserves near expanded Properties height so body does not jump when the sheet mounts", () => {
  // Two top-level keys: matches properties estimated-height floors (166).
  const doc = "---\ntitle: hi\nstatus: open\n---\n\n# Heading\n";
  assert.equal(frontmatterPlaceholderHeight(doc), 166);
  const placeholder = frontmatterPlaceholderRenderer();
  const end = doc.indexOf("\n#") + 1;
  const widget = placeholder.widget({
    from: 0,
    to: end,
    kind: "frontmatter-placeholder",
    source: doc.slice(0, end),
  });
  assert.equal(widget.estimatedHeight, 166);
});

test("placeholder ignores indented YAML continuations when counting rows", () => {
  const doc = "---\naliases:\n  - a\n  - b\n---\n";
  // One top-level key only (continuations ignored) → 134.5
  assert.equal(frontmatterPlaceholderHeight(doc), 134.5);
});

test("placeholder collapsed floor applies when the fence has no property rows", () => {
  assert.equal(frontmatterPlaceholderHeight("---\n---\n\n# Heading\n"), 69);
});
