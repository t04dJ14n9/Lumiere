import type { EditorState, Transaction } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { documentTree, treeReached } from "./api";

// What a text change may have altered, in syntax-tree terms only: no DOM,
// so other plugins' indexes reach it through api.ts in any project.

/** A span of the new document, in character positions. */
export interface Region {
  from: number;
  to: number;
}

const regions = new WeakMap<Transaction, Region | null>();

/**
 * The part of the new document whose blocks a text change may have
 * altered: every top-level syntax node, old or new, that touches the
 * change or the region found so far, widened to whole lines until stable.
 * Invariant: outside it, the syntax tree's top-level nodes are the old
 * ones, shifted, so blocks found there before are still exactly the blocks
 * there. (Deleting a fence's closing line extends the fence over text that
 * an old math block began in; that old block touches the region, so
 * everything it covered is inside.) `null` when the document did not
 * change.
 */
export function changedRegion(tr: Transaction): Region | null {
  const cached = regions.get(tr);
  if (cached !== undefined) {
    return cached;
  }
  const region = tr.docChanged ? withReach(tr, computeRegion(tr)) : null;
  regions.set(tr, region);
  return region;
}

/**
 * For indexes of the note's blocks outside Live Preview's own: the span of
 * the new document outside which a text change left the top-level blocks as
 * they were, shifted (`changedRegion`'s invariant). `undefined` when the text
 * did not change or a state has no Live Preview tree to tell.
 */
export function changedBlocks(tr: Transaction): Region | undefined {
  if (
    !tr.docChanged ||
    !tr.startState.field(documentTree, false) ||
    !tr.state.field(documentTree, false)
  ) {
    return undefined;
  }
  return changedRegion(tr) ?? undefined;
}

/**
 * An edit can also bring a tree that reaches further than the old one (the
 * background parse's progress, handed on with the edit): blocks there are
 * new, so the region takes them in.
 */
function withReach(tr: Transaction, region: Region): Region {
  const reach = treeReached(tr);
  if (reach === undefined) {
    return region;
  }
  return {
    from: Math.min(region.from, reach),
    to: Math.max(region.to, tr.state.field(documentTree).length),
  };
}

function computeRegion(tr: Transaction): Region {
  let from = Infinity;
  let to = -Infinity;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    from = Math.min(from, fromB);
    to = Math.max(to, toB);
  });
  const oldTree = tr.startState.field(documentTree, false);
  const back = tr.changes.invertedDesc;
  for (;;) {
    const next = settle(tr.state, { from, to });
    if (oldTree) {
      const oldFrom = back.mapPos(next.from, -1);
      const oldTo = back.mapPos(next.to, 1);
      for (const node of topLevel(oldTree, oldFrom, oldTo)) {
        next.from = Math.min(next.from, tr.changes.mapPos(node.from, -1));
        next.to = Math.max(next.to, tr.changes.mapPos(node.to, 1));
      }
    }
    if (next.from === from && next.to === to) {
      return next;
    }
    ({ from, to } = next);
  }
}

/** Widen to whole lines and to every new top-level node touched, until stable. */
function settle(state: EditorState, start: Region): Region {
  const tree = state.field(documentTree);
  let { from, to } = start;
  for (;;) {
    const lineFrom = state.doc.lineAt(from).from;
    const lineTo = state.doc.lineAt(to).to;
    let nextFrom = lineFrom;
    let nextTo = lineTo;
    for (const node of topLevel(tree, lineFrom, lineTo)) {
      nextFrom = Math.min(nextFrom, node.from);
      nextTo = Math.max(nextTo, node.to);
    }
    if (nextFrom === from && nextTo === to) {
      return { from, to };
    }
    from = nextFrom;
    to = nextTo;
  }
}

/**
 * Top-level nodes that touch `[from, to]` (inclusive). Starts at the first
 * one ending at or after `from` (`childAfter` descends the balanced tree),
 * so the cost does not grow with the nodes before the range.
 */
function topLevel(tree: Tree, from: number, to: number): Region[] {
  const nodes: Region[] = [];
  let node =
    from > 0 ? tree.topNode.childAfter(from - 1) : tree.topNode.firstChild;
  for (; node; node = node.nextSibling) {
    if (node.from > to) {
      break;
    }
    if (node.to >= from) {
      nodes.push({ from: node.from, to: node.to });
    }
  }
  return nodes;
}
