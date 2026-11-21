import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";
import { search } from "@codemirror/search";
import { currentFindMatch, findMatchTouches } from "./find-match";
import { withFindBar } from "../../../test/unit/support/find-bar";

function stateFor(
  doc: string,
  selection: EditorSelection,
  query?: ConstructorParameters<typeof SearchQuery>[0],
): EditorState {
  return withFindBar(
    EditorState.create({ doc, selection, extensions: search() }),
    query,
  );
}

test("the find match is the selection when it is exactly a match of the find query", () => {
  const doc = "aa Target bb target";
  const at = (from: number, to: number) => EditorSelection.single(from, to);
  // Case-insensitive by default, as the find bar's Aa starts off.
  assert.deepEqual(
    currentFindMatch(stateFor(doc, at(3, 9), { search: "target" })),
    EditorSelection.range(3, 9),
  );
  assert.ok(currentFindMatch(stateFor(doc, at(13, 19), { search: "target" })));
  // Opening the bar searches the selected text, as in Obsidian.
  assert.ok(currentFindMatch(stateFor(doc, at(3, 9))));
  assert.ok(
    currentFindMatch(
      stateFor(doc, at(3, 9), { search: "t.r", regexp: true }),
    ) === null,
  );
  assert.ok(
    currentFindMatch(
      stateFor(doc, at(3, 9), { search: "t\\w+", regexp: true }),
    ),
  );
  for (const [selection, query] of [
    // A selection that only contains a match, or part of one.
    [at(2, 9), { search: "target" }],
    [at(3, 8), { search: "target" }],
    [at(3, 9), { search: "target", caseSensitive: true }],
    // An empty or invalid query, or a caret.
    [at(3, 9), { search: "" }],
    [at(3, 9), { search: "(", regexp: true }],
    [EditorSelection.single(5), { search: "target" }],
  ] as const) {
    assert.equal(
      currentFindMatch(stateFor(doc, selection, query)),
      null,
      JSON.stringify([selection.main, query]),
    );
  }
});

test("a find match touches ranges it overlaps or abuts, as the reveal rule's selection does", () => {
  const state = stateFor("aa Target bb", EditorSelection.single(3, 9), {
    search: "target",
  });
  assert.equal(findMatchTouches(state, 0, 2), false);
  assert.equal(findMatchTouches(state, 0, 3), true);
  assert.equal(findMatchTouches(state, 5, 6), true);
  assert.equal(findMatchTouches(state, 9, 12), true);
  assert.equal(findMatchTouches(state, 10, 12), false);
});

test("a selection of the last query's text is no find match once the bar is closed", () => {
  // CodeMirror's first query is the text selected when its state is made.
  const closed = EditorState.create({
    doc: "aa Target bb",
    selection: EditorSelection.single(3, 9),
    extensions: search(),
  });
  assert.equal(currentFindMatch(closed), null);
  const open = stateFor("aa Target bb", EditorSelection.single(3, 9), {
    search: "target",
  });
  assert.ok(currentFindMatch(open));
});
