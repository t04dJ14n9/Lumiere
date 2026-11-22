import assert from "node:assert/strict";
import { test } from "node:test";
import { editorToShow } from "../../src/shared/open-placement";

const editor = (label: string, viewColumn: number, visible: boolean) => ({
  label,
  viewColumn,
  visible,
});

test("no open editor: nothing to show, so the PDF opens beside", () => {
  assert.equal(editorToShow([], 1), undefined);
});

test("an editor in view is the one to show, wherever it is", () => {
  assert.equal(editorToShow([editor("a", 1, true)], 1)?.label, "a");
  assert.equal(editorToShow([editor("a", 2, true)], 1)?.label, "a");
});

test("an editor behind a tab of another group is shown there", () => {
  assert.equal(editorToShow([editor("a", 2, false)], 1)?.label, "a");
});

test("an editor behind a tab of the active group is not shown: it would cover the editor the keyboard is in", () => {
  assert.equal(editorToShow([editor("a", 1, false)], 1), undefined);
});

test("with several editors, one in view wins over one behind a tab, and the active group's hidden one is passed over", () => {
  const editors = [
    editor("hidden-here", 1, false),
    editor("hidden-there", 2, false),
    editor("front", 3, true),
  ];
  assert.equal(editorToShow(editors, 1)?.label, "front");
  assert.equal(editorToShow(editors.slice(0, 2), 1)?.label, "hidden-there");
});

test("with no active group known, nothing is the active group's", () => {
  assert.equal(editorToShow([editor("a", 1, false)], undefined)?.label, "a");
});
