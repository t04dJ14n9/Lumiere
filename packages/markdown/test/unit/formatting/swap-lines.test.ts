import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownLanguageSupport } from "../../../src/markdown/dialect";
import { smartListsOn } from "../../../src/markdown/smart-lists";
import { swapLine } from "../../../src/plugins/formatting/swap-lines";
import { fixture } from "../features/fixture";

// Every expected note is read from Obsidian 1.15.0's swapLineUp and
// swapLineDown (not measured): with Smart lists on, a list item moves with
// the lines under it. "|" is the caret.

function swap(doc: string, step: 1 | -1, smartLists = true): string {
  const caret = doc.indexOf("|");
  let state = EditorState.create({
    doc: doc.replace("|", ""),
    selection: { anchor: caret },
    extensions: [markdownLanguageSupport(), smartListsOn.of(smartLists)],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  assert.equal(swapLine(step)(view), true);
  const head = state.selection.main.head;
  const text = state.doc.toString();
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

test("a list item swaps with its sibling, children and all", () => {
  assert.equal(
    swap("- a|\n\t- a1\n- b\n\t- b1", 1),
    "- b\n\t- b1\n- a|\n\t- a1",
  );
  assert.equal(swap("- a\n- b|\n    - b1", -1), "- b|\n    - b1\n- a");
});

test("numbers stay where they are", () => {
  assert.equal(swap("1. a|\n2. b", 1), "1. b\n2. a|");
  assert.equal(swap("9. a\n10. b|", -1), "9. b|\n10. a");
});

test("an item swaps with one paragraph line, and stops at the note's edge", () => {
  assert.equal(swap("text\n- a|", -1), "- a|\ntext");
  assert.equal(swap("- a|\n- b", -1), "- a|\n- b");
});

test("up past its parent, an item ends the parent's previous sibling", () => {
  assert.equal(swap("- p\n- q\n\t- c|", -1), "- p\n\t- c|\n- q");
  assert.equal(
    swap("1. p\n2. q\n\t1. c|\n\t2. d", -1),
    "1. p\n\t1. c|\n2. q\n\t1. d",
  );
  // No sibling above the parent: nothing moves.
  assert.equal(swap("- q\n\t- c|", -1), "- q\n\t- c|");
});

test("down past its parent's end, an item becomes the next item's first child", () => {
  assert.equal(swap("- p\n\t- c|\n- q\n\t- d", 1), "- p\n- q\n\t- c|\n\t- d");
  assert.equal(swap("- p\n\t- c|\n- q", 1), "- p\n- q\n\t- c|");
  assert.equal(swap("- p\n\t1. c|\n- q", 1), "- p\n- q\n\t1. c|");
  assert.equal(
    swap("- p\n\t3. c|\n- q\n\t1. d", 1),
    "- p\n- q\n\t1. c|\n\t1. d",
  );
});

test("off a list item, or with Smart lists off, single lines move", () => {
  assert.equal(swap("a|\nb", 1), "b\na|");
  assert.equal(swap("- a|\n\t- a1\n- b", 1, false), "\t- a1\n- a|\n- b");
  // A list marker in a code block is no list item.
  assert.equal(swap("```\n- a|\n- b\n```", 1), "```\n- b\n- a|\n```");
});

test("the Smart lists plugin switches list moves on for Swap Line", async () => {
  for (const enabled of [true, false]) {
    const f = fixture();
    await f.configure({
      formatting: { enabled: true, config: {} },
      smartLists: { enabled, config: {} },
    });
    f.view.dispatch({
      changes: {
        from: 0,
        to: f.view.state.doc.length,
        insert: "- a\n\t- a1\n- b",
      },
      selection: { anchor: 1 },
    });
    assert.equal(await f.handlers.get("editor:swap-line-down")!(), true);
    assert.equal(
      f.view.state.doc.toString(),
      enabled ? "- b\n- a\n\t- a1" : "\t- a1\n- a\n- b",
    );
    await f.root.dispose();
  }
});
