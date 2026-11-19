import assert from "node:assert/strict";
import { test } from "node:test";
import { isFindKey, parseViewSettings } from "../../src/shared/view-settings";

const key = (modifiers: Partial<Record<string, boolean>>, name = "f") => ({
  key: name,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

test("⌘F on a Mac and Ctrl+F elsewhere open Find, with no other modifier", () => {
  const mac = { mac: true, shortcuts: true };
  const other = { mac: false, shortcuts: true };
  assert.equal(isFindKey(key({ metaKey: true }), mac), true);
  assert.equal(isFindKey(key({ ctrlKey: true }, "F"), other), true);
  // VS Code's own: Find in Files, and the like.
  assert.equal(isFindKey(key({ metaKey: true, shiftKey: true }), mac), false);
  assert.equal(isFindKey(key({ metaKey: true, altKey: true }), mac), false);
  assert.equal(isFindKey(key({ ctrlKey: true, shiftKey: true }), other), false);
  // The other platform's modifier is not this one's.
  assert.equal(isFindKey(key({ ctrlKey: true }), mac), false);
  assert.equal(isFindKey(key({ metaKey: true }), other), false);
  assert.equal(isFindKey(key({ metaKey: true }, "g"), mac), false);
});

test("with the viewer's shortcuts off, ⌘F is left to VS Code", () => {
  assert.equal(
    isFindKey(key({ metaKey: true }), { mac: true, shortcuts: false }),
    false,
  );
  assert.equal(parseViewSettings({}).keyboardShortcuts, true);
  assert.equal(
    parseViewSettings({ keyboardShortcuts: false }).keyboardShortcuts,
    false,
  );
});
