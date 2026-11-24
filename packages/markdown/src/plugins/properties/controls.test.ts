import test from "node:test";
import assert from "node:assert/strict";
import { focusAfterRemoval } from "./controls";
import { refusalNotice } from "./control-edits";
import { rowKeyAction } from "./row-navigation";

test("property removal focuses the next surviving row, then the previous row", () => {
  const rows = ["a", "b", "c", "d"];
  assert.equal(focusAfterRemoval(rows, ["b", "c"]), "d");
  assert.equal(focusAfterRemoval(rows, ["c", "d"]), "b");
  assert.equal(focusAfterRemoval(rows, rows), undefined);
  assert.equal(focusAfterRemoval(rows, ["a", "d"]), "b");
});

test("a refused property edit says the note is read-only, not that a name is duplicated", () => {
  const readOnly =
    "This note is read-only, so its properties cannot be changed.";
  const duplicate =
    "This change could not be applied. Check for duplicate names or YAML aliases, then try again.";
  const set = { type: "set" as const, key: "a", value: 2 };
  assert.equal(refusalNotice(set, true), readOnly);
  assert.equal(refusalNotice(set, false), duplicate);
  assert.equal(refusalNotice({ type: "add", key: "b" }, true), readOnly);
  assert.equal(refusalNotice({ type: "add", key: "b" }, false), undefined);
  assert.equal(
    refusalNotice({ type: "rename", key: "a", name: "b" }, false),
    undefined,
  );
});

test("property row keys preserve motion priority and Vim-only actions", () => {
  const key = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
    key,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...modifiers,
  });
  assert.equal(rowKeyAction(key("ArrowDown", { altKey: true }), true), "body");
  assert.equal(rowKeyAction(key("Tab"), false), "next");
  assert.equal(rowKeyAction(key("Tab", { shiftKey: true }), false), "previous");
  for (const [letter, action] of [
    ["j", "next"],
    ["k", "previous"],
    ["h", "name"],
    ["l", "value"],
    ["i", "value"],
    ["A", "value"],
    ["o", "add"],
  ] as const) {
    assert.equal(rowKeyAction(key(letter), true), action);
    assert.equal(rowKeyAction(key(letter), false), undefined);
  }
  assert.equal(rowKeyAction(key("j", { ctrlKey: true }), true), "next");
  assert.equal(
    rowKeyAction(key("Z", { metaKey: true, shiftKey: true }), false),
    "redo",
  );
  assert.equal(rowKeyAction(key("z", { ctrlKey: true }), true), "undo");
  assert.equal(rowKeyAction(key("S", { metaKey: true }), false), "save");
  assert.equal(
    rowKeyAction(key("Backspace", { ctrlKey: true }), true),
    undefined,
  );
  assert.equal(rowKeyAction(key("Backspace"), true), undefined);
});
