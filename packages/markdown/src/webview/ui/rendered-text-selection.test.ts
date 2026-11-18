import assert from "node:assert/strict";
import test from "node:test";
import { keyKeepsRenderedSelection } from "./rendered-text-selection";

const key = (
  name: string,
  modifiers: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }> = {},
) => ({
  key: name,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...modifiers,
});

test("Copy and a modifier alone keep a selection in a callout's text", () => {
  assert.equal(keyKeepsRenderedSelection(key("c", { metaKey: true })), true);
  assert.equal(keyKeepsRenderedSelection(key("C", { ctrlKey: true })), true);
  for (const modifier of ["Shift", "Meta", "Control", "Alt"]) {
    assert.equal(keyKeepsRenderedSelection(key(modifier)), true, modifier);
  }
});

test("typing, moving or another shortcut goes back to the editor's selection", () => {
  for (const pressed of [
    key("a"),
    key("ArrowLeft"),
    key("Escape"),
    key("Backspace"),
    key("v", { metaKey: true }),
    key("c", { metaKey: true, altKey: true }),
  ]) {
    assert.equal(
      keyKeepsRenderedSelection(pressed),
      false,
      JSON.stringify(pressed),
    );
  }
});
