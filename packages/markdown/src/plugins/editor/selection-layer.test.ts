import test from "node:test";
import assert from "node:assert/strict";
import type { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { selectionMarkers } from "./selection-layer";
import { tintedSpans } from "./cursor-cell";

test("an empty selection does not read selection geometry", () => {
  let reads = 0;
  const view = {
    state: {
      selection: { ranges: [{ empty: true, from: 1, to: 1 }] },
    },
    scrollDOM: {
      scrollLeft: 0,
      scrollTop: 0,
      getBoundingClientRect() {
        reads += 1;
        return { left: 0, top: 0 };
      },
    },
    contentDOM: {
      getBoundingClientRect() {
        reads += 1;
        return { left: 0, top: 0, width: 10, height: 10 };
      },
    },
  } as unknown as EditorView;
  assert.deepEqual(selectionMarkers(view), []);
  assert.equal(reads, 0);
});

test("a ranged selection still reads geometry", () => {
  let reads = 0;
  const view = {
    state: {
      selection: { ranges: [{ empty: false, from: 0, to: 4 }] },
      facet: () => ({ mode: () => "typing" }),
    },
    viewportLineBlocks: [],
    scrollDOM: {
      scrollLeft: 0,
      scrollTop: 0,
      getBoundingClientRect() {
        reads += 1;
        return { left: 0, top: 0 };
      },
    },
    contentDOM: {
      getBoundingClientRect() {
        reads += 1;
        return { left: 0, top: 0, width: 10, height: 10 };
      },
    },
  } as unknown as EditorView;
  assert.deepEqual(selectionMarkers(view), []);
  assert.equal(reads, 2);
});

const doc = EditorState.create({ doc: "abcdef\nxy" }).doc;
const range = (anchor: number, head: number) => ({
  anchor,
  head,
  from: Math.min(anchor, head),
  to: Math.max(anchor, head),
});

test("outside Vim's visual mode the whole range is tinted", () => {
  assert.deepEqual(tintedSpans(doc, range(1, 4), false), [{ from: 1, to: 4 }]);
});

test("visual mode leaves the cursor's character to the block cursor", () => {
  // Forward: the cursor sits on the last character inside the range.
  assert.deepEqual(tintedSpans(doc, range(1, 4), true), [{ from: 1, to: 3 }]);
  // Backward: the cursor sits on the first.
  assert.deepEqual(tintedSpans(doc, range(4, 1), true), [{ from: 2, to: 4 }]);
});

test("back on the starting character only the cursor shows", () => {
  // CodeMirror-vim keeps one character selected under the cursor.
  assert.deepEqual(tintedSpans(doc, range(2, 3), true), []);
});

test("a cursor on the line break keeps the text before it tinted", () => {
  assert.deepEqual(tintedSpans(doc, range(3, 6), true), [{ from: 3, to: 6 }]);
  assert.deepEqual(tintedSpans(doc, range(3, 7), true), [{ from: 3, to: 6 }]);
});
