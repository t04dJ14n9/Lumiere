import test from "node:test";
import assert from "node:assert/strict";
import {
  selectionToolbarActions,
  shouldShowSelectionToolbar,
} from "../../../src/plugins/cursorBridge/selection-toolbar";

test("Add to Chat toolbar shows only for Cursor with a focused non-empty selection", () => {
  assert.equal(
    shouldShowSelectionToolbar({
      inCursor: true,
      from: 2,
      to: 8,
      hasFocus: true,
    }),
    true,
  );
  assert.equal(
    shouldShowSelectionToolbar({
      inCursor: false,
      from: 2,
      to: 8,
      hasFocus: true,
    }),
    false,
  );
  assert.equal(
    shouldShowSelectionToolbar({
      inCursor: true,
      from: 4,
      to: 4,
      hasFocus: true,
    }),
    false,
  );
  assert.equal(
    shouldShowSelectionToolbar({
      inCursor: true,
      from: 2,
      to: 8,
      hasFocus: false,
    }),
    false,
  );
});

test("selection toolbar actions match Cursor Add to Chat and Quick Edit labels", () => {
  assert.deepEqual(
    selectionToolbarActions(false).map((action) => [
      action.id,
      action.label,
      action.shortcut,
    ]),
    [
      ["chat", "Add to Chat", "Ctrl+L"],
      ["edit", "Quick Edit", "Ctrl+K"],
    ],
  );
  assert.deepEqual(
    selectionToolbarActions(true).map((action) => action.shortcut),
    ["⌘+L", "⌘+K"],
  );
});
