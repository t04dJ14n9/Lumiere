import test from "node:test";
import assert from "node:assert/strict";
import {
  builtInWorkArea,
  windowStateOn,
  type MacScreen,
} from "../../vscode/display";

// The owner's layout: a 1920×1080 external primary (menu bar 30 pt), the
// built-in 1728×1117 Retina screen below it, another external to the left.
const primary: MacScreen = {
  isBuiltIn: false,
  x: 0,
  y: 0,
  width: 1920,
  height: 1050,
};
const builtIn: MacScreen = {
  isBuiltIn: true,
  x: -889,
  y: -1117,
  width: 1728,
  height: 1085,
};
const left: MacScreen = {
  isBuiltIn: false,
  x: -1920,
  y: 0,
  width: 1920,
  height: 1080,
};

test("the test window goes to the built-in screen, in Electron's coordinates", () => {
  // AppKit's y runs up from the primary's bottom edge; Electron's runs down
  // from its top: 1080 - (-1117 + 1085) = 1112, below the primary screen.
  assert.deepEqual(builtInWorkArea([primary, builtIn, left], 1080), {
    x: -889,
    y: 1112,
    width: 1728,
    height: 1085,
  });
});

test("a built-in screen that is the primary keeps y 0 at its top", () => {
  const laptop: MacScreen = { ...builtIn, x: 0, y: 0, height: 1085 };
  assert.deepEqual(builtInWorkArea([laptop, left], 1117), {
    x: 0,
    y: 32,
    width: 1728,
    height: 1085,
  });
});

test("one screen, or no built-in one, leaves VS Code's choice alone", () => {
  assert.equal(builtInWorkArea([builtIn], 1117), undefined);
  assert.equal(builtInWorkArea([primary, left], 1080), undefined);
});

test("the seeded state is VS Code's last window, maximized on that area", () => {
  const area = { x: -889, y: 1112, width: 1728, height: 1085 };
  assert.deepEqual(windowStateOn(area), {
    windowsState: {
      lastActiveWindow: { uiState: { mode: 0, ...area } },
      openedWindows: [],
    },
  });
});
