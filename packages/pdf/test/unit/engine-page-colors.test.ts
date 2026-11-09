/**
 * How the viewer's page colours reach the engine (src/webview/page-colors.ts):
 * the engine is told first, and then whatever redraws the pages.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connectEnginePageColors,
  currentPageColors,
  onPageColorsChange,
  rememberPageColors,
} from "../../src/webview/page-colors";

// The module marks the page's root element; there is none under Node.
(globalThis as { document?: unknown }).document = {
  getElementById: () => null,
};

test("an engine is told the page colours at once, then on every change, before the pages are redrawn", () => {
  rememberPageColors("normal");
  const told: string[] = [];
  connectEnginePageColors((mode) => told.push(`engine ${mode}`));
  assert.deepEqual(told, ["engine normal"]);
  const stop = onPageColorsChange(() =>
    told.push(`redraw ${currentPageColors()}`),
  );
  rememberPageColors("dark");
  rememberPageColors("normal");
  stop();
  assert.deepEqual(told, [
    "engine normal",
    "engine dark",
    "redraw dark",
    "engine normal",
    "redraw normal",
  ]);
});

test("a newer engine replaces the one before it, and starts in the colours of the moment", () => {
  rememberPageColors("dark");
  const first: string[] = [];
  const second: string[] = [];
  connectEnginePageColors((mode) => first.push(mode));
  connectEnginePageColors((mode) => second.push(mode));
  rememberPageColors("normal");
  assert.deepEqual(first, ["dark"]);
  assert.deepEqual(second, ["dark", "normal"]);
});
