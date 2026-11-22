import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SIDE_PANEL,
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  clampSidePanelWidth,
  parseSidePanelState,
  sameSidePanelState,
} from "../../src/shared/side-panel";

test("a new panel is closed, 240 px wide, on the Outline", () => {
  assert.deepEqual(DEFAULT_SIDE_PANEL, {
    open: false,
    width: 240,
    tab: "outline",
  });
});

test("a width is kept within the panel's limits and, when the viewer is known, within 60 % of it", () => {
  assert.equal(clampSidePanelWidth(10), MIN_SIDE_PANEL_WIDTH);
  assert.equal(clampSidePanelWidth(5000), MAX_SIDE_PANEL_WIDTH);
  assert.equal(clampSidePanelWidth(300), 300);
  assert.equal(clampSidePanelWidth(300.4), 300);
  assert.equal(clampSidePanelWidth(900, 1000), 600);
  // A narrow editor still gets a usable panel: the minimum wins.
  assert.equal(clampSidePanelWidth(300, 200), MIN_SIDE_PANEL_WIDTH);
});

test("a state is read field by field: open is required, the rest falls back", () => {
  assert.deepEqual(
    parseSidePanelState({ open: true, width: 300, tab: "bookmarks" }),
    { open: true, width: 300, tab: "bookmarks" },
  );
  assert.deepEqual(parseSidePanelState({ open: false }), DEFAULT_SIDE_PANEL);
  assert.deepEqual(
    parseSidePanelState({ open: true, width: "wide", tab: "search" }),
    { open: true, width: 240, tab: "outline" },
  );
  assert.equal(parseSidePanelState({ open: true, width: 9999 })?.width, 640);
  for (const bad of [undefined, null, 3, "open", [], { open: "yes" }, {}]) {
    assert.equal(parseSidePanelState(bad), undefined, JSON.stringify(bad));
  }
});

test("states are the same when open, width and tab are", () => {
  const a = { open: true, width: 240, tab: "outline" } as const;
  assert.equal(sameSidePanelState(a, { ...a }), true);
  assert.equal(sameSidePanelState(a, { ...a, width: 241 }), false);
  assert.equal(sameSidePanelState(a, { ...a, tab: "bookmarks" }), false);
  assert.equal(sameSidePanelState(a, { ...a, open: false }), false);
});
