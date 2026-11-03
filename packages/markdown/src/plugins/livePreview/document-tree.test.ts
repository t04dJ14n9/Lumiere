import assert from "node:assert/strict";
import test from "node:test";
import {
  EditorState,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  documentTree,
  DocumentTreeParser,
  FIRST_PAINT_PARSE_CHARS,
  PARSE_AHEAD_CHARS,
  replaceDocumentTree,
  type IdleScheduler,
  type ParsedView,
} from "./document-tree";
import { backgroundUpdate } from "../editor/api";
import { markdownTree } from "./api";
import { blockIndex, renderRevision } from "./blocks";
import { blockRenderers } from "./registry";
import {
  cachedMarkdown,
  markdownLanguageSupport,
  markdownParser,
  parseMarkdown,
} from "../../markdown/dialect";
import { note } from "../../../test/support/perf-note";

const paragraph = "word ".repeat(40).trim();
/** About 160 000 characters of separate paragraphs. */
const paragraphs = `${paragraph}\n\n`.repeat(800);

/** The editor as Live Preview runs in it: CodeMirror's Markdown language. */
function editorState(doc: string, extensions: Extension[] = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdownLanguageSupport(), documentTree, ...extensions],
  });
}

function nodes(tree: Tree): string[] {
  const result: string[] = [];
  tree.iterate({
    enter: (node) => {
      result.push(`${node.name}:${node.from}-${node.to}`);
    },
  });
  return result;
}

/** The top-level syntax subtree at `position`: the same object when reused. */
function blockAt(tree: Tree, position: number): Tree | null {
  return tree.topNode.childAfter(position)!.tree;
}

test("a large note opens with its first band parsed, on CodeMirror's own parse", () => {
  const state = editorState(paragraphs);
  const tree = state.field(documentTree);
  assert.ok(tree.length >= FIRST_PAINT_PARSE_CHARS, `${tree.length}`);
  assert.ok(tree.length < FIRST_PAINT_PARSE_CHARS + 1000, "whole blocks only");
  // One parse: CodeMirror's language already holds what Live Preview read.
  assert.equal(ensureSyntaxTree(state, 0, 0), tree);
  assert.equal(cachedMarkdown(state.doc), undefined, "no whole-note parse");
});

test("a small note is whole at once, and kept for readers that parse it", () => {
  const state = editorState("# Title\n\nSome text.\n");
  const tree = state.field(documentTree);
  assert.equal(tree.length, state.doc.length);
  assert.equal(cachedMarkdown(state.doc), tree);
  assert.equal(markdownTree(state), tree);
});

test("an edit keeps the tree's reach and reuses the blocks after the edit", () => {
  const doc = note(4000);
  let state = editorState(doc);
  const reach = 60000;
  const prefix = ensureSyntaxTree(state, reach, 1e9)!;
  state = state.update({ effects: replaceDocumentTree.of(prefix) }).state;
  const at = doc.indexOf("## Section", 20000);
  const later = doc.indexOf("Paragraph", 40000);
  const edited = state.update({ changes: { from: at, insert: "x" } }).state;
  const tree = edited.field(documentTree);
  assert.ok(tree.length >= reach, `${tree.length} still reaches ${reach}`);
  assert.ok(tree.length < edited.doc.length, "the edit parsed no further");
  assert.equal(blockAt(tree, later + 1), blockAt(prefix, later));
  assert.deepEqual(
    nodes(tree),
    nodes(markdownParser.parse(edited.doc.sliceString(0, tree.length))),
  );
});

test("a whole tree stays whole across an edit", () => {
  const doc = note(2000);
  let state = editorState(doc);
  state = state.update({
    effects: replaceDocumentTree.of(ensureSyntaxTree(state, doc.length, 1e9)!),
  }).state;
  const edited = state.update({ changes: { from: 100, insert: "```\n" } });
  assert.equal(
    edited.state.field(documentTree).length,
    edited.state.doc.length,
  );
  assert.deepEqual(
    nodes(edited.state.field(documentTree)),
    nodes(markdownParser.parse(edited.state.doc.toString())),
  );
});

test("parse progress made before an edit is handed on to the next document", () => {
  const doc = note(4000);
  const state = editorState(doc);
  // As CodeMirror's background parse would: progress not yet published.
  const progress = ensureSyntaxTree(state, 60000, 1e9)!;
  assert.ok(state.field(documentTree).length < 60000);
  const later = doc.indexOf("Paragraph", 50000);
  const edited = state.update({ changes: { from: 10, insert: "x" } }).state;
  const tree = edited.field(documentTree);
  assert.ok(tree.length >= 60000, `${tree.length}`);
  assert.equal(blockAt(tree, later + 2), blockAt(progress, later + 1));
});

test("an edit to the first line can make or unmake frontmatter, as a fresh parse finds", () => {
  const doc = "x\ntitle: a\n---\n\n# Heading\n\ntext\n";
  let state = editorState(doc);
  for (const edit of [
    { from: 0, to: 1, insert: "---" },
    { from: 0, to: 3, insert: "y" },
  ]) {
    state = state.update({ changes: edit }).state;
    assert.deepEqual(
      nodes(state.field(documentTree)),
      nodes(markdownParser.parse(state.doc.toString())),
      JSON.stringify(state.doc.toString()),
    );
  }
});

/** A view stand-in whose idle slices and scrolling the test drives. */
function parsedView(doc: string, extensions: Extension[] = []) {
  const slices = new Set<(budget: number) => void>();
  const scheduler: IdleScheduler = {
    request(slice) {
      slices.add(slice);
      return () => slices.delete(slice);
    },
  };
  const dispatched: Transaction[] = [];
  const view = {
    state: editorState(doc, extensions),
    viewport: { from: 0, to: 2000 },
    dispatch(spec: TransactionSpec) {
      const transaction = view.state.update(spec);
      dispatched.push(transaction);
      view.state = transaction.state;
      parser.update(viewUpdate(transaction, false));
    },
  };
  const viewUpdate = (transaction: Transaction, viewportChanged: boolean) =>
    ({
      state: transaction.state,
      startState: transaction.startState,
      changes: transaction.changes,
      docChanged: transaction.docChanged,
      transactions: [transaction],
      viewportChanged,
    }) as unknown as ViewUpdate;
  const parser = new DocumentTreeParser(
    view as unknown as ParsedView,
    scheduler,
  );
  return {
    view,
    slices,
    dispatched,
    tree: () => view.state.field(documentTree),
    async scroll(from: number, to: number) {
      view.viewport = { from, to };
      parser.update(viewUpdate(view.state.update({}), true));
      await new Promise((resolve) => setImmediate(resolve));
    },
    /**
     * Run pending slices, each allowed one block, until none are left.
     * ensureSyntaxTree uses Date.now(), so budget 0 still gets ~1 ms of
     * work; a negative budget stops after the first advance.
     */
    runSlices() {
      let count = 0;
      while (slices.size) {
        const [slice] = slices;
        slices.delete(slice!);
        slice!(-1);
        count++;
      }
      return count;
    },
  };
}

test("a scroll past the parsed prefix parses up to the viewport, not the whole note", async () => {
  const doc = note(4000);
  const editor = parsedView(doc);
  assert.ok(editor.tree().length < 20000);
  const to = Math.floor(doc.length / 2);
  await editor.scroll(to - 3000, to);
  const tree = editor.tree();
  assert.ok(tree.length >= to + PARSE_AHEAD_CHARS, `${tree.length} >= ${to}`);
  assert.ok(tree.length < to + PARSE_AHEAD_CHARS + 1000);
  assert.equal(cachedMarkdown(editor.view.state.doc), undefined);
  // CodeMirror's readers get the same tree, and the editor saves no view
  // state for the update.
  assert.equal(syntaxTree(editor.view.state), tree);
  assert.equal(editor.dispatched.at(-1)!.annotation(backgroundUpdate), true);
});

test("idle slices finish the tree a little at a time, and it matches a fresh parse", async () => {
  const doc = note(2000);
  const editor = parsedView(doc);
  await editor.scroll(30000, 33000);
  const slices = editor.runSlices();
  assert.ok(slices > 100, `${slices} slices`);
  const tree = editor.tree();
  assert.equal(tree.length, doc.length);
  assert.equal(cachedMarkdown(editor.view.state.doc), tree);
  assert.equal(syntaxTree(editor.view.state), tree, "one tree");
  assert.deepEqual(nodes(tree), nodes(markdownParser.parse(doc)));
});

test("blocks in a part of the tree a parse newly reached are indexed", async () => {
  const table = "| a | b |\n| - | - |\n| 1 | 2 |";
  const doc = Array.from({ length: 3000 }, (_, i) =>
    i % 10 === 0 ? table : `Paragraph ${i} with some words.`,
  ).join("\n\n");
  const tables = (state: EditorState) =>
    state.field(blockIndex).filter((block) => block.kind === "Table").length;
  const renderer = blockRenderers.of({
    kind: "Table",
    editing: "widget",
    match: (node: { name: string }) => node.name === "Table",
  } as never);
  const editor = parsedView(doc, [renderRevision, blockIndex, renderer]);
  const opening = tables(editor.view.state);
  assert.ok(opening > 0 && opening < 300, `${opening} tables at first`);
  // Progress handed on with an edit: the newly covered part is indexed.
  ensureSyntaxTree(editor.view.state, 40000, 1e9);
  editor.view.dispatch({ changes: { from: 5, insert: "x" } });
  const reached = editor.tree().length;
  assert.ok(reached >= 40000);
  const covered = editor.view.state
    .field(blockIndex)
    .filter((block) => block.kind === "Table" && block.to <= reached).length;
  assert.equal(
    covered,
    (doc.slice(0, reached).match(/\| a \| b \|/g) ?? []).length,
  );
  // The rest, published by the idle slices: every table.
  editor.runSlices();
  assert.equal(tables(editor.view.state), 300);
});

test("markdownTree reads Live Preview's tree, else CodeMirror's, else parses", () => {
  const doc = "# Title\n\nbody";
  const live = editorState(doc);
  assert.equal(markdownTree(live), live.field(documentTree));
  const source = EditorState.create({
    doc,
    extensions: [markdownLanguageSupport()],
  });
  assert.equal(markdownTree(source), syntaxTree(source));
  const bare = EditorState.create({ doc });
  assert.equal(markdownTree(bare), parseMarkdown(bare.doc));
});
