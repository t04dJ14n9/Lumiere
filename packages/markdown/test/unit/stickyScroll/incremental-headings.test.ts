import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, type Extension } from "@codemirror/state";
import type { RangeSet } from "@codemirror/state";
import type { GutterMarker } from "@codemirror/view";
import { documentTree } from "../../../src/plugins/livePreview/api";
import { headingIndex } from "../../../src/plugins/stickyScroll/model";
import { headingGutterClasses } from "../../../src/plugins/lineNumbers/headings";

// Sticky scroll's heading model and the line-number gutter's marked lines
// read again only the blocks an edit changed. Over random edits, what they
// hold must equal a rebuild from scratch.

const CHUNKS = [
  "Plain paragraph text.",
  "# Heading",
  "## Heading",
  "> quoted\n> # more",
  "```js\n# not a heading\n```",
  "```\nunclosed",
  "- item\n- item two\n  - nested",
  "Setext\n===",
  "Setext two\n---",
  "$$\nx^2\n$$",
  "    indented code",
];
const SNIPPETS = [
  "\n",
  "\n\n",
  "```",
  "> ",
  "#",
  "# ",
  "x",
  "---",
  "- ",
  "===",
];

/** A small deterministic generator, so a failure reproduces from its seed. */
function random(seed: number) {
  let value = seed;
  return (n: number) => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return (value >>> 16) % n;
  };
}

const extensions: Extension[] = [
  documentTree,
  headingIndex,
  headingGutterClasses,
];

function markers(set: RangeSet<GutterMarker>): string[] {
  const found: string[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, _to, marker) => {
    found.push(`${from}:${marker.elementClass}`);
  });
  return found;
}

test("after any edit, the incremental heading model and gutter equal a rebuild", () => {
  for (let seed = 1; seed <= 150; seed++) {
    const next = random(seed);
    const doc = Array.from(
      { length: 8 + next(20) },
      () => CHUNKS[next(CHUNKS.length)],
    ).join(next(3) ? "\n\n" : "\n");
    let state = EditorState.create({ doc, extensions });
    for (let step = 0; step < 25; step++) {
      const length = state.doc.length;
      const at = next(length + 1);
      const changes = next(3)
        ? { from: at, insert: SNIPPETS[next(SNIPPETS.length)]! }
        : { from: at, to: Math.min(length, at + next(12)) };
      state = state.update({ changes }).state;
      const expected = EditorState.create({ doc: state.doc, extensions });
      const context = `seed ${seed}, step ${step}: ${JSON.stringify(state.doc.toString())}`;
      assert.deepEqual(
        state.field(headingIndex),
        expected.field(headingIndex),
        context,
      );
      assert.deepEqual(
        markers(state.field(headingGutterClasses)),
        markers(expected.field(headingGutterClasses)),
        context,
      );
    }
  }
});
