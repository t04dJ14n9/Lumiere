import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  clickSearches,
  tagAt,
  tagFromEventTarget,
} from "../../../src/plugins/tags/webview";

test("as in Obsidian, a click on a tag searches for it; a Shift-click or a drag only selects", () => {
  const click = { button: 0, shiftKey: false };
  assert.equal(clickSearches(click, true, "tag"), true);
  assert.equal(clickSearches(click, true, "a/b"), true);
  assert.equal(clickSearches({ ...click, shiftKey: true }, true, "tag"), false);
  assert.equal(clickSearches({ ...click, button: 1 }, true, "tag"), false);
  // A drag that ends on the tag leaves a selection (or moves past the threshold).
  assert.equal(clickSearches(click, false, "tag"), false);
  assert.equal(clickSearches(click, true, undefined), false);
  assert.equal(clickSearches(click, true, "123"), false);
});

test("tagFromEventTarget ignores non-elements and unknown nodes (BH-050)", () => {
  assert.equal(tagFromEventTarget(null), undefined);
  assert.equal(tagFromEventTarget({} as EventTarget), undefined);
});

test("Follow Link finds the tag the caret is in or touches, as Obsidian's command searches it", () => {
  const state = EditorState.create({
    doc: "see #tag/x and #b, `#code` #123\n",
  });
  const at = (offset: number) => tagAt(state, offset);
  assert.equal(at(3), undefined);
  assert.equal(at(4), "tag/x");
  assert.equal(at(7), "tag/x");
  assert.equal(at(10), "tag/x");
  assert.equal(at(11), undefined);
  assert.equal(at(state.doc.toString().indexOf("#b") + 2), "b");
  assert.equal(at(state.doc.toString().indexOf("#code") + 2), undefined);
  assert.equal(at(state.doc.toString().indexOf("#123") + 2), undefined);
});
