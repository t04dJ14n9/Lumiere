import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseToolbarMode,
  parseToolbarSettings,
  parseVsCodeToolbarMode,
  showStatusBarButtons,
} from "../../src/shared/toolbar-settings";

test("parseToolbarMode keeps slim for stand-alone hosts; floating migrates to chrome", () => {
  assert.equal(parseToolbarMode("chrome"), "chrome");
  assert.equal(parseToolbarMode("none"), "none");
  assert.equal(parseToolbarMode("slim"), "slim");
  assert.equal(parseToolbarMode("floating"), "chrome");
  for (const value of [undefined, null, "", "Slim", "compact", 42]) {
    assert.equal(parseToolbarMode(value), "chrome");
  }
});

test("VS Code setting parser maps slim/floating to chrome", () => {
  assert.equal(parseVsCodeToolbarMode("chrome"), "chrome");
  assert.equal(parseVsCodeToolbarMode("none"), "none");
  assert.equal(parseVsCodeToolbarMode("slim"), "chrome");
  assert.equal(parseVsCodeToolbarMode("floating"), "chrome");
  assert.equal(parseVsCodeToolbarMode(undefined), "chrome");
});

test("status bar buttons show unless set to never", () => {
  assert.equal(showStatusBarButtons("auto"), true);
  assert.equal(showStatusBarButtons(undefined), true);
  assert.equal(showStatusBarButtons("always"), true);
  assert.equal(showStatusBarButtons("never"), false);
});

test("toolbar settings from a message fall back to the defaults", () => {
  assert.deepEqual(parseToolbarSettings({ mode: "floating", dock: "left" }), {
    mode: "chrome",
    dock: "left",
  });
  assert.deepEqual(parseToolbarSettings({ mode: "slim" }), {
    mode: "slim",
    dock: "bottom",
  });
  assert.deepEqual(parseToolbarSettings({ mode: "none", dock: "top" }), {
    mode: "none",
    dock: "top",
  });
  assert.deepEqual(parseToolbarSettings({ mode: "floating", dock: "middle" }), {
    mode: "chrome",
    dock: "bottom",
  });
  for (const value of [undefined, null, 3]) {
    assert.deepEqual(parseToolbarSettings(value), {
      mode: "chrome",
      dock: "bottom",
    });
  }
});
