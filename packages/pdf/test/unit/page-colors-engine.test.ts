import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAGE_COLORS_ENGINE_AVAILABLE,
  parsePageColorsMessage,
  renderablePageColors,
  type PageColorsMessage,
} from "../../src/shared/page-colors-engine";

test("the engine draws dark paper: the host's intent is what the viewer applies", () => {
  assert.equal(PAGE_COLORS_ENGINE_AVAILABLE, true);
  assert.equal(renderablePageColors("dark"), "dark");
  assert.equal(renderablePageColors("normal"), "normal");
});

test("the worker takes the page colours from its message, and nothing else's", () => {
  for (const mode of ["normal", "dark"] as const) {
    const message: PageColorsMessage = { kind: "lumiere.pageColors", mode };
    assert.equal(parsePageColorsMessage(message), mode);
  }
  for (const other of [
    undefined,
    null,
    "dark",
    { kind: "init" },
    { kind: "pages.render", mode: "dark" },
    { kind: "lumiere.pageColors" },
    { kind: "lumiere.pageColors", mode: "sepia" },
  ]) {
    assert.equal(parsePageColorsMessage(other), undefined);
  }
});
