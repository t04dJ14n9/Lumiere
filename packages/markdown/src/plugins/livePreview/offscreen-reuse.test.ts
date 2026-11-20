import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { WidgetType, type DecorationSet } from "@codemirror/view";
import { documentTree } from "./document-tree";
import { inlineRenderers } from "./registry";
import { inlineDecorations } from "./inline";
import { replaceDocumentTree } from "./api";
import { parseMarkdown } from "../../markdown/dialect";
import {
  offscreenReuse,
  type OffscreenDrawing,
  type OffscreenReuse,
} from "./offscreen-reuse";

class Embed extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  override eq(other: Embed): boolean {
    return other.source === this.source;
  }
  toDOM(): HTMLElement {
    throw new Error("Not mounted in a unit test");
  }
}

// Off-screen embeds decorated (the screen is the first 200 characters).
let decorated = 0;
const embeds = inlineRenderers.of({
  nodes: ["WikiEmbed"],
  persistent: true,
  decorate(node, cx) {
    if (node.from >= 200) {
      decorated++;
    }
    if (!cx.revealed(node.from, node.to)) {
      const source = cx.state.sliceDoc(node.from, node.to);
      cx.replace(node.from, node.to, new Embed(source));
    }
  },
});

const doc = Array.from(
  { length: 200 },
  (_, i) => `Paragraph ${i}.\n\nSee ![[note-${i}]] here.`,
).join("\n\n");
const screen = [{ from: 0, to: 200 }];

function opened(anchor: number): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [documentTree, embeds],
  });
  return state.update({
    effects: replaceDocumentTree.of(parseMarkdown(state.doc)),
  }).state;
}

function described(set: DecorationSet): string[] {
  const found: string[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    found.push(
      `${from}-${to}:${(value.spec.widget as Embed | undefined)?.source}`,
    );
  });
  return found;
}

function draw(state: EditorState, previous?: OffscreenDrawing) {
  const offscreen: { reuse?: OffscreenReuse; drawing?: OffscreenDrawing } = {};
  const reuse = previous && offscreenReuse(previous, state);
  if (reuse) {
    offscreen.reuse = reuse;
  }
  decorated = 0;
  const set = inlineDecorations(state, screen, offscreen);
  return { set, drawing: offscreen.drawing };
}

test("a caret move redraws only the off-screen embeds near the caret", () => {
  const state = opened(3);
  const first = draw(state);
  assert.ok(decorated > 190);
  const moved = state.update({ selection: { anchor: 8 } }).state;
  const next = draw(moved, first.drawing);
  assert.equal(decorated, 0);
  assert.deepEqual(described(next.set), described(draw(moved).set));
});

test("a caret moved into an off-screen embed reveals it, and the one it left draws again", () => {
  const into = (index: number) => doc.indexOf(`note-${index}]]`);
  const before = opened(into(150));
  const first = draw(before);
  const after = before.update({ selection: { anchor: into(100) } }).state;
  const next = draw(after, first.drawing);
  // The embed the caret left and the one it entered.
  assert.equal(decorated, 2);
  assert.deepEqual(described(next.set), described(draw(after).set));
  assert.ok(!described(next.set).some((d) => d.endsWith(":![[note-100]]")));
});

test("nothing is reused across a new tree", () => {
  const state = opened(3);
  const first = draw(state);
  const edited = state.update({ changes: { from: 0, insert: "x" } }).state;
  assert.equal(offscreenReuse(first.drawing, edited), undefined);
});

test("over random caret moves and selections, reused drawings equal a full one", () => {
  const chained = Array.from(
    { length: 60 },
    (_, i) =>
      `Text **bold ${i}**![[note-${i}]] and *it*![[img-${i}.png]]\n![[tail-${i}]]`,
  ).join("\n\n");
  let state = EditorState.create({
    doc: chained,
    extensions: [documentTree, embeds],
  });
  state = state.update({
    effects: replaceDocumentTree.of(parseMarkdown(state.doc)),
  }).state;
  let drawing = draw(state).drawing;
  let seed = 7;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >>> 16) % n;
  };
  for (let step = 0; step < 200; step++) {
    const anchor = next(chained.length + 1);
    const head = next(4) ? anchor : next(chained.length + 1);
    state = state.update({ selection: { anchor, head } }).state;
    const reused = draw(state, drawing);
    assert.deepEqual(
      described(reused.set),
      described(draw(state).set),
      `step ${step}: ${anchor}-${head}`,
    );
    drawing = reused.drawing;
  }
});
