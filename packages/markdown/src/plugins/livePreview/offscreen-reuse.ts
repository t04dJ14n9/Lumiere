import type { EditorState, Range, Transaction } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { documentTree } from "./document-tree";
import { renderRevision } from "./blocks";
import { cachedRevealRanges, inlineRenderers } from "./registry";
import { unresolvedLinks } from "../links/api";

/**
 * What the persistent inline renderers (tall embeds) drew off screen, per
 * node, and what it was drawn from. A caret move rebuilt every one of them
 * though only those near the caret can change.
 */
export interface OffscreenDrawing {
  state: EditorState;
  drawn: Map<string, readonly Range<Decoration>[]>;
}

/** The previous drawing, and the spans where it may no longer hold. */
export interface OffscreenReuse {
  previous: OffscreenDrawing;
  dirty: readonly { from: number; to: number }[];
}

/**
 * Whether transactions may change what an off-screen widget draws: any edit,
 * effect or reconfiguration may. A drawing made before one is forgotten,
 * even when the inline decorations skip that update (while composing).
 */
export function outdatesOffscreenDrawing(
  transactions: readonly Transaction[],
): boolean {
  return transactions.some(
    (tr) => tr.docChanged || tr.effects.length > 0 || tr.reconfigured,
  );
}

/**
 * Whether `previous`, made since the last such transaction, can stand for
 * off-screen widgets in `state`, apart from those in the returned dirty
 * spans: it can unless the tree, renderer list, render revision or set of
 * unresolved links changed.
 */
export function offscreenReuse(
  previous: OffscreenDrawing | undefined,
  state: EditorState,
): OffscreenReuse | undefined {
  if (!previous) {
    return undefined;
  }
  const before = previous.state;
  if (
    before.field(documentTree) !== state.field(documentTree) ||
    before.facet(inlineRenderers) !== state.facet(inlineRenderers) ||
    before.field(renderRevision, false) !==
      state.field(renderRevision, false) ||
    before.field(unresolvedLinks, false) !== state.field(unresolvedLinks, false)
  ) {
    return undefined;
  }
  return { previous, dirty: [...revealScopes(before), ...revealScopes(state)] };
}

const SCOPE = /^(Paragraph|Task|ATXHeading[1-6]|SetextHeading[1-6]|TableCell)$/;

/**
 * The text whose reveal can depend on the selection: each reveal range,
 * widened to the paragraphs, headings or table cells around its ends,
 * since a reveal reaches along a chain of inline elements within one.
 */
function revealScopes(state: EditorState): { from: number; to: number }[] {
  const tree = state.field(documentTree);
  return cachedRevealRanges(state).map((range) => {
    const ends = [range.from, range.to].flatMap((at) => [
      scopeAround(tree, at, -1),
      scopeAround(tree, at, 1),
    ]);
    return {
      from: Math.min(range.from, ...ends.map((node) => node?.from ?? Infinity)),
      to: Math.max(range.to, ...ends.map((node) => node?.to ?? -Infinity)),
    };
  });
}

function scopeAround(
  tree: Tree,
  position: number,
  side: -1 | 1,
): SyntaxNode | null {
  for (
    let node: SyntaxNode | null = tree.resolveInner(position, side);
    node;
    node = node.parent
  ) {
    if (SCOPE.test(node.name)) {
      return node;
    }
  }
  return null;
}
