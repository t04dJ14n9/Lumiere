import assert from "node:assert/strict";
import { test } from "node:test";
import { ANNOTATION_COLOR_PRESETS } from "../../src/shared/annotation-tools";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_OPACITY,
} from "../../src/shared/sidecar-format";
import {
  BUILTIN_HIGHLIGHT_COLOR,
  BUILTIN_HIGHLIGHT_OPACITY,
  HIGHLIGHT_BY_PAPER,
  LEGACY_SIDECAR_OPACITY,
  displayHighlightOpacity,
  highlightStyleForPaper,
  highlightStyleOf,
  highlightToolDefaults,
} from "../../src/shared/highlight-style";

test("light and dark paper have distinct lighter highlight pairs", () => {
  assert.deepEqual(HIGHLIGHT_BY_PAPER.normal, {
    color: "#FFE566",
    opacity: 0.3,
  });
  assert.deepEqual(HIGHLIGHT_BY_PAPER.dark, {
    color: "#FFF59D",
    opacity: 0.4,
  });
  assert.notDeepEqual(
    HIGHLIGHT_BY_PAPER.normal,
    HIGHLIGHT_BY_PAPER.dark,
    "paper modes must not share one fixed swatch",
  );
  // Lighter / more translucent than EmbedPDF stock #FFCD45 @ 1.
  assert.ok(HIGHLIGHT_BY_PAPER.normal.opacity < 1);
  assert.ok(HIGHLIGHT_BY_PAPER.dark.opacity < 1);
});

test("sidecar defaults match light-paper pair (parse fallback)", () => {
  assert.equal(BUILTIN_HIGHLIGHT_COLOR, HIGHLIGHT_BY_PAPER.normal.color);
  assert.equal(BUILTIN_HIGHLIGHT_OPACITY, HIGHLIGHT_BY_PAPER.normal.opacity);
  assert.equal(DEFAULT_HIGHLIGHT_COLOR, BUILTIN_HIGHLIGHT_COLOR);
  assert.equal(DEFAULT_HIGHLIGHT_OPACITY, BUILTIN_HIGHLIGHT_OPACITY);
});

test("status-bar yellow preset matches light-paper highlight", () => {
  assert.equal(ANNOTATION_COLOR_PRESETS[0], HIGHLIGHT_BY_PAPER.normal.color);
});

test("highlightToolDefaults and highlightStyleOf follow paper mode", () => {
  assert.deepEqual(highlightToolDefaults("normal"), {
    strokeColor: "#FFE566",
    color: "#FFE566",
    opacity: 0.3,
  });
  assert.deepEqual(highlightToolDefaults("dark"), {
    strokeColor: "#FFF59D",
    color: "#FFF59D",
    opacity: 0.4,
  });
  assert.deepEqual(highlightStyleForPaper("dark"), HIGHLIGHT_BY_PAPER.dark);
  assert.deepEqual(highlightStyleOf({}, "dark"), {
    color: "#FFF59D",
    opacity: 0.4,
  });
  assert.deepEqual(highlightStyleOf({ color: "#ff6b6b", opacity: 0.5 }), {
    color: "#FF6B6B",
    opacity: 0.5,
  });
});

test("dark paper preserves legacy 0.45 effective opacity (~0.18) while new 0.4 stays 0.4", () => {
  assert.equal(LEGACY_SIDECAR_OPACITY, 0.45);
  // Old sidecars: CSS used to multiply by 0.4 on dark → ~0.18.
  assert.equal(displayHighlightOpacity(0.45, "dark"), 0.18);
  // New dark default must render as stored (no *0.4).
  assert.equal(displayHighlightOpacity(0.4, "dark"), 0.4);
  // Light paper never applied the dark factor.
  assert.equal(displayHighlightOpacity(0.45, "normal"), 0.45);
  assert.equal(displayHighlightOpacity(0.3, "normal"), 0.3);
  assert.equal(displayHighlightOpacity(0.3, "dark"), 0.3);
});
