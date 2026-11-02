import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { TreeCursor } from "@lezer/common";
import { documentTree } from "./document-tree";
import { inlineDecorations } from "./inline";
import { parseMarkdown } from "../../markdown/dialect";
import { replaceDocumentTree } from "./api";

// Work for one screen of a note, counted rather than timed so the check
// holds on any machine: syntax tree steps (cursor moves to a sibling or
// child) while decorating that screen. It must not grow with the note.
function stepsForOneScreen(sections: number): number {
  const doc = Array.from(
    { length: sections },
    (_, i) =>
      `## Section ${i}\n\nText with **bold**, \`code\` and [[Link ${i}]].\n\n- item\n  - nested\n- [ ] task\n\n1. one\n2. two\n\n> quote`,
  ).join("\n\n");
  let state = EditorState.create({ doc, extensions: [documentTree] });
  // The whole note parsed, as after the background parse.
  state = state.update({
    effects: replaceDocumentTree.of(parseMarkdown(state.doc)),
  }).state;
  const middle = Math.floor(doc.length / 2);
  const screen = [{ from: middle, to: middle + 3000 }];
  const cursor = TreeCursor.prototype as unknown as Record<
    string,
    (...args: unknown[]) => boolean
  >;
  const methods = ["nextSibling", "prevSibling", "firstChild", "enterChild"];
  const originals = methods.map((name) => cursor[name]!);
  let steps = 0;
  methods.forEach((name, index) => {
    cursor[name] = function (this: unknown, ...args: unknown[]) {
      steps++;
      return originals[index]!.apply(this, args);
    };
  });
  try {
    inlineDecorations(state, screen);
  } finally {
    methods.forEach((name, index) => (cursor[name] = originals[index]!));
  }
  return steps;
}

test("decorating one screen walks as much of the tree in a note four times longer", () => {
  const short = stepsForOneScreen(500);
  const long = stepsForOneScreen(2000);
  // Looking for a list marker under the document once walked every block
  // of the note for each screen: 4x the steps for 4x the note.
  assert.ok(
    long < short * 1.5,
    `${long} steps for 2,000 sections against ${short} for 500`,
  );
});
