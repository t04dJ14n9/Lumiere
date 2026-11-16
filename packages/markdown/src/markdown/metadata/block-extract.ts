import type { Tree, SyntaxNode } from "@lezer/common";
import type { NoteMetadata, Position } from "./types";

/**
 * Blocks with a `^id`, as Obsidian scopes them: an id on a list item's line
 * names that item with its bullet and children; an id inside a quote or
 * callout names the whole quote; anywhere else it names the top-level
 * section holding it (a paragraph, a heading's line, a table). An id alone
 * on a line names the block just before it.
 */
export function extractBlocks(
  source: string,
  tree: Tree,
  position: (from: number, to: number) => Position,
): NoteMetadata["blocks"] {
  const blocks = Object.create(null) as NoteMetadata["blocks"];
  for (const match of source.matchAll(
    /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*(?=\r?$)/gm,
  )) {
    const start = tree.resolve(match.index, 1);
    if (excludedBlock(start)) {
      continue;
    }
    let node = blockOf(start);
    const id = match[1]!;
    if (
      source.slice(node.from, node.to).trim() === "^" + id &&
      node.prevSibling
    ) {
      node = node.prevSibling;
    }
    const text = source
      .slice(node.from, node.to)
      .replace(new RegExp(`(?:^|[ \\t])\\^${id}[ \\t]*(?=\\r?$)`, "gm"), "");
    blocks[id] = {
      id,
      from: node.from,
      to: node.to,
      text: node.name === "ListItem" ? dedented(source, node.from, text) : text,
      position: position(node.from, node.to),
    };
  }
  return blocks;
}

/** The block an id at `node` names (see `extractBlocks`). */
function blockOf(node: SyntaxNode): SyntaxNode {
  let quote: SyntaxNode | undefined;
  let item: SyntaxNode | undefined;
  let section = node;
  for (let at: SyntaxNode | null = node; at?.parent; at = at.parent) {
    if (at.name === "Blockquote") {
      quote = at;
    }
    if (at.name === "ListItem" && !item) {
      item = at;
    }
    if (at.parent.name === "Document") {
      section = at;
    }
  }
  return quote ?? item ?? section;
}

/**
 * A nested item's text with its children's indentation made relative to
 * the item, so an embed renders it as a list, not as code.
 */
function dedented(source: string, from: number, text: string): string {
  const column = from - (source.lastIndexOf("\n", from - 1) + 1);
  if (column === 0) {
    return text;
  }
  const indent = new RegExp(`^[ \\t]{0,${column}}`);
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : line.replace(indent, "")))
    .join("\n");
}

function excludedBlock(node: SyntaxNode): boolean {
  let ancestor = node;
  let excluded = false;
  while (ancestor.parent) {
    if (
      [
        "FencedCode",
        "CodeBlock",
        "Frontmatter",
        "MathBlock",
        "ObsidianComment",
      ].includes(ancestor.name)
    ) {
      excluded = true;
    }
    ancestor = ancestor.parent;
  }
  return excluded;
}
