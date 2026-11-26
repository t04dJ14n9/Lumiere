import { Compartment, type StateEffect } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { opensWithCalloutMarker } from "../../markdown/callout-marker";
import type { BlockRenderer } from "./api";
import { DeferredBlockWidget } from "./deferred-block";
import { frontmatterPlaceholderRenderer } from "./frontmatter-placeholder";
import { blockRenderers } from "./registry";

/**
 * Raw Markdown that a feature still to load will replace with a widget (a
 * callout's `> [!note]`, a table's pipes, `$$`, a fence of Mermaid) is not
 * shown: the block's place is held with an empty shell of its estimated
 * height (the one below-fold blocks use), and the widget takes it when the
 * feature registers. Without this the note shows source for a moment and
 * every block below jumps when the widgets arrive.
 */

/** The shells, in a compartment so that they can be taken away as one. */
const shells = new Compartment();

/**
 * Once the features have loaded, a block whose renderer never came shows its
 * source. Taking the shells away changes the renderers, so the blocks are
 * indexed again.
 */
export function endPendingBlocks(): StateEffect<unknown> {
  return shells.reconfigure([]);
}

type Matches = (node: SyntaxNodeRef, state: EditorState) => boolean;

/** How much of a block's start decides what it is. */
const LOOK = 200;

const MATCHES: Readonly<Record<string, { nodes: string[]; matches: Matches }>> =
  {
    Table: { nodes: ["Table"], matches: (node) => node.name === "Table" },
    callout: {
      nodes: ["Blockquote"],
      matches: (node, state) =>
        node.name === "Blockquote" &&
        opensWithCalloutMarker(
          state.sliceDoc(node.from, Math.min(node.to, node.from + LOOK)),
        ),
    },
    math: {
      nodes: ["MathBlock"],
      matches: (node) => node.name === "MathBlock",
    },
    diagram: {
      nodes: ["FencedCode"],
      matches(node, state) {
        const info = node.node.getChild("CodeInfo");
        return (
          node.name === "FencedCode" &&
          !!info &&
          state
            .sliceDoc(info.from, info.to)
            .trim()
            .split(/\s+/)[0]
            ?.toLowerCase() === "mermaid"
        );
      },
    },
    embed: {
      nodes: ["Paragraph"],
      matches(node, state) {
        const first = node.name === "Paragraph" && node.node.firstChild;
        return (
          !!first &&
          ["WikiEmbed", "Image"].includes(first.name) &&
          state.sliceDoc(node.from, first.from).trim() === "" &&
          state.sliceDoc(first.to, node.to).trim() === ""
        );
      },
    },
  };

/** A math block that ends mid-line holds that whole line, as the math renderer does. */
function blockRange(kind: string, node: SyntaxNodeRef, state: EditorState) {
  if (kind !== "math") {
    return { from: node.from, to: node.to };
  }
  const line = state.doc.lineAt(node.to);
  const rest = state.doc.sliceString(node.to, line.to);
  return { from: node.from, to: rest.trim() ? line.to : node.to };
}

function standIn(kind: string): BlockRenderer {
  const { nodes, matches } = MATCHES[kind]!;
  return {
    kind: `pending-${kind}`,
    nodes,
    editing: "widget",
    // Gone once the feature's own renderer is there (and for good once the
    // features have loaded: `endPendingBlocks`).
    match: (node, state) =>
      !state.facet(blockRenderers).some((renderer) => renderer.kind === kind) &&
      matches(node, state),
    range: (node, state) => blockRange(kind, node, state),
    widget: (block) => new DeferredBlockWidget({ ...block, kind }),
  };
}

/**
 * Extensions that hold the place of the blocks of `kinds` (renderer kinds)
 * until their features load: the Properties skeleton for frontmatter
 * ("properties"), an empty shell for the others.
 */
export function pendingBlocks(kinds: readonly string[]) {
  const held = kinds.flatMap((kind) => {
    if (kind === "properties") {
      return [blockRenderers.of(frontmatterPlaceholderRenderer())];
    }
    return kind in MATCHES ? [blockRenderers.of(standIn(kind))] : [];
  });
  return shells.of(held);
}
