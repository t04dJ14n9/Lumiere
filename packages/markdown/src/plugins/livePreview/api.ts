import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
  type Transaction,
} from "@codemirror/state";
import type { SyntaxNodeRef, Tree } from "@lezer/common";
import { ensureSyntaxTree, language, syntaxTree } from "@codemirror/language";
import type { EditorView, WidgetType } from "@codemirror/view";
import type { Disposer } from "@workshop/core";
import {
  parseMarkdown,
  rememberParsedMarkdown,
} from "../../markdown/dialect/parser";
export interface RenderBlock {
  from: number;
  to: number;
  kind: string;
  source: string;
  /**
   * The block's Markdown with the quote markers of its later lines removed,
   * when it starts after `> ` on its first line; what a rendered widget
   * renders. Absent when it equals `source`.
   */
  markdown?: string;
}
export interface InlineContext {
  state: EditorState;
  /**
   * The visible range being decorated; absent for persistent widgets drawn
   * off screen. A renderer of a node that can reach far past the screen (an
   * unclosed `$$`) marks only this range.
   */
  readonly visible?: { from: number; to: number } | undefined;
  /** Inclusive selection touch, extended through inline ancestors and abutting elements. */
  revealed(from: number, to: number): boolean;
  mark(
    from: number,
    to: number,
    cls: string,
    attributes?: Record<string, string>,
  ): void;
  hide(from: number, to: number): void;
  replace(from: number, to: number, widget: WidgetType): void;
  line(at: number, cls: string, attributes?: Record<string, string>): void;
}
export interface InlineRenderer {
  nodes: readonly string[];
  /**
   * Keep these widgets outside the viewport so `estimatedHeight` stays in
   * CodeMirror's height map. Viewport-only inline decorations drop them as
   * soon as they scroll away, which collapses tall `|WxH` embeds to one line.
   */
  persistent?: boolean;
  decorate(node: SyntaxNodeRef, context: InlineContext): void;
}
export interface BlockRenderer {
  kind: string;
  /** Optional complete list of node names that `match` may accept. */
  nodes?: readonly string[];
  match(node: SyntaxNodeRef, state: EditorState): boolean;
  editing: "reveal" | "widget";
  showSource?(state: EditorState, block: RenderBlock): boolean;
  /**
   * While the caret is in a revealed block, keep the rendered result below
   * the source and mark the source lines with this class. Math no longer
   * uses this (BH-009: source only while editing); the hook remains for
   * other block kinds that want an Obsidian-style editing preview.
   */
  editingPreview?: { sourceClass: string };
  range?(node: SyntaxNodeRef, state: EditorState): { from: number; to: number };
  widget(block: RenderBlock): WidgetType;
  estimatedHeight?: number;
}
export interface LivePreview {
  /** Persistent widgets intersecting the source range; source overrides and folds are excluded. */
  renderedWidgets?(
    state: EditorState,
    from: number,
    to: number,
  ): readonly RenderBlock[];
  /** `editing: "reveal"` blocks whose source is visible in the range. */
  revealedSourceBlocks?(
    state: EditorState,
    from: number,
    to: number,
  ): readonly RenderBlock[];
  /** Disjoint folded spans in source order, for source-line motion policy. */
  foldedRanges?(state: EditorState): readonly { from: number; to: number }[];
  verticalPosition?(state: EditorState, direction: -1 | 1): number | undefined;
  /** False where a rendered block hides the source (inline decorations would be misplaced). */
  sourceVisibleAt?(state: EditorState, position: number): boolean;
  visiblePosition?(
    state: EditorState,
    position: number,
  ): { position: number; block: boolean };
  inlineExtensions?(): Extension;
  position?(
    source: string,
    element: EditorView["dom"],
    point: { clientX: number; clientY: number },
  ): number | undefined;
  block(renderer: BlockRenderer): Disposer;
  inline(renderer: InlineRenderer): Disposer;
  readonly mode: "source" | "livePreview";
  setMode(mode: "source" | "livePreview"): void;
}
declare module "@workshop/core" {
  interface Services {
    livePreview: LivePreview;
  }
}

/**
 * How much of a large note we parse before the first paint: the opening
 * viewport and a margin, so its decorations do not wait on the whole note.
 * `documentTreeParser` parses further as the viewport moves and finishes the
 * rest in idle slices.
 */
export const FIRST_PAINT_PARSE_CHARS = 10000;

/** Swap in a further-parsed (or rebuilt) tree of the same document. */
export const replaceDocumentTree = StateEffect.define<Tree>();

/** Time for a parse that must finish now, in milliseconds: no limit. */
const NOW = 1e9;

/**
 * CodeMirror's syntax tree of `state`, parsed now at least up to `upto`
 * (in whole blocks, so it may reach past it). Live Preview and CodeMirror
 * share one parse, kept by CodeMirror's language; this only asks it to go
 * further when Live Preview needs more of the note than it has yet.
 */
export function languageTree(state: EditorState, upto: number): Tree {
  const tree = syntaxTree(state);
  if (tree.length >= Math.min(upto, state.doc.length)) {
    return tree;
  }
  return ensureSyntaxTree(state, upto, NOW) ?? tree;
}

/** A whole tree is also kept for readers that parse the document. */
function remembered(doc: Text, tree: Tree): Tree {
  if (tree.length >= doc.length) {
    rememberParsedMarkdown(doc, tree);
  }
  return tree;
}

/**
 * Live Preview's syntax tree: CodeMirror's, covering the whole note, or
 * while a large note is still parsing, a prefix that covers at least the
 * opening band and, through `documentTreeParser`, the viewport. It never
 * covers less after a transaction than before it: a whole tree stays
 * whole, a prefix keeps its end (an edit parses again only where it
 * touched; CodeMirror reuses the rest). A state without the Markdown
 * language (a bare test state) gets a parse of its own.
 */
export const documentTree = StateField.define<Tree>({
  create: (state) =>
    remembered(
      state.doc,
      state.facet(language)
        ? languageTree(state, FIRST_PAINT_PARSE_CHARS)
        : parseMarkdown(state.doc),
    ),
  update(tree, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(replaceDocumentTree)) {
        return remembered(transaction.newDoc, effect.value);
      }
    }
    const state = transaction.state;
    if (!state.facet(language)) {
      return transaction.docChanged ? parseMarkdown(state.doc) : tree;
    }
    const reach =
      tree.length >= transaction.startState.doc.length
        ? state.doc.length
        : transaction.changes.mapPos(tree.length, 1);
    const next = languageTree(state, Math.max(reach, FIRST_PAINT_PARSE_CHARS));
    return next === tree ? tree : remembered(state.doc, next);
  },
});

/**
 * Whether `transaction` brought a tree that is more than the old one parsed
 * again where the text changed: a replaced tree, or a parse that reached
 * further (CodeMirror's background parse, or Live Preview's, published
 * with or without an edit). Indexes of the note look at the new part then.
 */
export function treeReached(transaction: Transaction): number | undefined {
  const before = transaction.startState.field(documentTree, false);
  const after = transaction.state.field(documentTree, false);
  if (!before || !after || before === after) {
    return undefined;
  }
  const reach =
    before.length >= transaction.startState.doc.length
      ? transaction.newDoc.length
      : transaction.changes.mapPos(before.length, 1);
  return after.length > reach ||
    transaction.effects.some((effect) => effect.is(replaceDocumentTree))
    ? reach
    : undefined;
}

/**
 * The Markdown syntax tree of an editor state: Live Preview's while it is
 * on, else CodeMirror's language tree. Either may cover only a prefix of a
 * large note that is still parsing. A state with neither (a bare test
 * state) gets a full parse.
 */
export function markdownTree(state: EditorState): Tree {
  return (
    state.field(documentTree, false) ??
    (state.facet(language) ? syntaxTree(state) : parseMarkdown(state.doc))
  );
}

export { editTouches, isPlainTextEdit } from "./plain-edit";
export { changedBlocks } from "./changed-region";
export { findMatchTouches } from "./find-match";
