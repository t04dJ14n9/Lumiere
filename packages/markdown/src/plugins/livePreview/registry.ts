import {
  Facet,
  StateField,
  type Range,
  type Transaction,
} from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { OffscreenDrawing, OffscreenReuse } from "./offscreen-reuse";
import { revealRanges } from "../../webview/ui/pointer-selection";
import type { EditorState, SelectionRange } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { documentTree } from "./document-tree";
import { inlineHtmlEnd } from "./inline-html";
import type { BlockRenderer, InlineContext, InlineRenderer } from "./api";
import { editTouches, isPlainTextEdit } from "./plain-edit";
export const blockRenderers = Facet.define<
  BlockRenderer,
  readonly BlockRenderer[]
>({
  combine: (values) => values,
});
export const inlineRenderers = Facet.define<
  InlineRenderer,
  readonly InlineRenderer[]
>({
  combine: (values) => values,
});
/**
 * Reveal ranges are a pure function of an immutable EditorState. The opening
 * frame asks `revealed()` once per block and inline element, so compute them
 * once per state instead of mapping the selection into a fresh array on every
 * call. This also shaves every redecoration and scroll frame.
 */
const revealRangesCache = new WeakMap<EditorState, readonly SelectionRange[]>();

export function cachedRevealRanges(
  state: EditorState,
): readonly SelectionRange[] {
  let ranges = revealRangesCache.get(state);
  if (!ranges) {
    ranges = revealRanges(state);
    revealRangesCache.set(state, ranges);
  }
  return ranges;
}

/** Inclusive endpoints keep source visible at a block's last character. */
export function revealed(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return cachedRevealRanges(state).some(
    (range) => range.from <= to && range.to >= from,
  );
}

const inlineElements = new Set([
  "StrongEmphasis",
  "Emphasis",
  "Strikethrough",
  "Highlight",
  "InlineCode",
  "Link",
  "Autolink",
  "WikiLink",
  "WikiEmbed",
  "Image",
  "InlineMath",
  "HTMLTag",
]);
type RevealRange = { from: number; to: number };
// Syntax, not selection, determines chains. Reuse them while the caret moves.
const inlineChains = new WeakMap<Tree, Map<number, readonly RevealRange[]>>();

/** Outermost inline elements and their zero-gap neighbours reveal together. */
export function inlineRevealRange(
  state: EditorState,
  from: number,
  to: number,
): RevealRange {
  const tree = state.field(documentTree);
  let node: SyntaxNode | null = tree.resolveInner(from, 1);
  while (node) {
    // Inline HTML pairs are siblings, not ancestors, in Lezer's tree.
    if (
      /^(Paragraph|Task|ATXHeading[1-6]|SetextHeading[1-6]|TableCell)$/.test(
        node.name,
      )
    ) {
      break;
    }
    node = node.parent;
  }
  if (!node) {
    return { from, to };
  }
  let scopes = inlineChains.get(tree);
  if (!scopes) {
    scopes = new Map();
    inlineChains.set(tree, scopes);
  }
  let chains = scopes.get(node.from);
  if (!chains) {
    chains = collectInlineChains(state, node);
    scopes.set(node.from, chains);
  }
  return (
    chains.find((range) => range.from <= from && range.to >= to) ?? { from, to }
  );
}

function collectInlineChains(
  state: EditorState,
  scope: SyntaxNode,
): RevealRange[] {
  const elements: RevealRange[] = [];
  scope.cursor().iterate((node) => {
    if (inlineElements.has(node.name)) {
      elements.push({
        from: node.from,
        to: inlineHtmlEnd(node.node, state) ?? node.to,
      });
    }
  });
  const chains: RevealRange[] = [];
  for (const element of elements) {
    const previous = chains.at(-1);
    if (previous && element.from <= previous.to) {
      previous.to = Math.max(previous.to, element.to);
    } else {
      chains.push({ ...element });
    }
  }
  return chains;
}

export interface PersistentInlineEntry {
  name: string;
  from: number;
  to: number;
  /** Absent for an entry carried to a newer tree; looked up when drawn. */
  node?: SyntaxNode;
}
const persistentNodesCache = new WeakMap<
  Tree,
  Map<string, readonly PersistentInlineEntry[]>
>();

export function cachedPersistentNodes(
  tree: Tree,
  persistent: ReadonlySet<string>,
): readonly PersistentInlineEntry[] {
  const key = [...persistent].sort().join("|");
  let byKey = persistentNodesCache.get(tree);
  if (!byKey) {
    byKey = new Map();
    persistentNodesCache.set(tree, byKey);
  }
  const existing = byKey.get(key);
  if (existing) {
    return existing;
  }
  const found: PersistentInlineEntry[] = [];
  tree.iterate({
    enter: (node) => {
      if (!persistent.has(node.name)) {
        return;
      }
      found.push({
        name: node.name,
        from: node.from,
        to: node.to,
        node: node.node,
      });
      return false;
    },
  });
  byKey.set(key, found);
  return found;
}

/**
 * Draws the persistent inline widgets outside the visible ranges. With
 * `reuse`, a widget away from its dirty spans keeps what it drew last time
 * instead of being decorated again. Returns this drawing, for next time.
 */
export function decoratePersistentOffViewport(
  state: EditorState,
  builder: InlineContext & { readonly ranges: Range<Decoration>[] },
  visibleRanges: readonly { from: number; to: number }[],
  reuse?: OffscreenReuse,
): OffscreenDrawing {
  const drawing: OffscreenDrawing = { state, drawn: new Map() };
  const allRenderers = state.facet(inlineRenderers);
  const persistent = new Set(
    allRenderers.filter((r) => r.persistent).flatMap((r) => r.nodes),
  );
  if (persistent.size === 0) {
    return drawing;
  }
  const tree = state.field(documentTree);
  for (const entry of cachedPersistentNodes(tree, persistent)) {
    if (visibleRanges.some((v) => entry.from < v.to && entry.to > v.from)) {
      continue;
    }
    const key = `${entry.name}:${entry.from}:${entry.to}`;
    const kept =
      reuse && !isDirty(reuse, entry) && reuse.previous.drawn.get(key);
    if (kept) {
      builder.ranges.push(...kept);
      drawing.drawn.set(key, kept);
      continue;
    }
    const node = entry.node ?? nodeOf(tree, entry);
    const start = builder.ranges.length;
    if (node) {
      allRenderers
        .find((r) => r.nodes.includes(entry.name))
        ?.decorate(node, builder);
    }
    drawing.drawn.set(key, builder.ranges.slice(start));
  }
  return drawing;
}

function isDirty(
  reuse: OffscreenReuse,
  entry: { from: number; to: number },
): boolean {
  return reuse.dirty.some(
    (span) => span.from <= entry.to && span.to >= entry.from,
  );
}

function nodeOf(tree: Tree, entry: PersistentInlineEntry): SyntaxNode | null {
  for (
    let node: SyntaxNode | null = tree.resolveInner(entry.from, 1);
    node && node.from >= entry.from;
    node = node.parent
  ) {
    if (node.name === entry.name && node.to === entry.to) {
      return node;
    }
  }
  return null;
}

/**
 * Hands a tree's embeds (the nodes drawn while off screen) on to the next
 * tree through an edit that cannot add, remove or reshape one, so typing
 * does not walk every node of a long note to find them again (14 ms a key
 * on an 835 KB note).
 */
export const persistentNodesCarry = StateField.define<null>({
  create: () => null,
  update(value, transaction) {
    const before = transaction.startState.field(documentTree, false);
    const after = transaction.state.field(documentTree, false);
    const known = before && persistentNodesCache.get(before);
    if (
      known &&
      after &&
      after !== before &&
      !persistentNodesCache.has(after) &&
      embedsUnchanged(transaction, known)
    ) {
      const map = (at: number) => transaction.changes.mapPos(at);
      persistentNodesCache.set(
        after,
        new Map(
          [...known].map(([key, entries]) => [
            key,
            entries.map(({ name, from, to }) => ({
              name,
              from: map(from),
              to: map(to),
            })),
          ]),
        ),
      );
    }
    return value;
  },
});

function embedsUnchanged(
  transaction: Transaction,
  known: Map<string, readonly PersistentInlineEntry[]>,
): boolean {
  if (!isPlainTextEdit(transaction)) {
    return false;
  }
  const before = transaction.startState.doc;
  const after = transaction.newDoc;
  let marks = false;
  transaction.changes.iterChanges((...change) => {
    const [fromA, toA, , , inserted] = change;
    // An image or embed starts with `![`; a word on its line can reshape it.
    const line = before.lineAt(fromA);
    marks ||=
      /[![\]()]/.test(before.sliceString(fromA, toA) + inserted.toString()) ||
      /!\[/.test(line.text + "\n" + after.line(line.number).text);
  });
  return (
    !marks &&
    ![...known.values()].some((entries) =>
      entries.some((entry) => editTouches(transaction, entry.from, entry.to)),
    )
  );
}
