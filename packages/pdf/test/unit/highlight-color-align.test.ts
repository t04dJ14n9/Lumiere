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
  EMBEDPDF_STOCK_HIGHLIGHT_COLOR,
  EMBEDPDF_STOCK_HIGHLIGHT_OPACITY,
  HIGHLIGHT_BY_PAPER,
  LEGACY_SIDECAR_OPACITY,
  displayHighlightAppearance,
  displayHighlightOpacity,
  highlightStyleForPaper,
  highlightStyleOf,
  highlightToolDefaults,
  isEmbedPdfStockHighlight,
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

test("EmbedPDF stock #FFCD45@1 is recognized (CVM dark-paper dazzle)", () => {
  assert.equal(EMBEDPDF_STOCK_HIGHLIGHT_COLOR, "#FFCD45");
  assert.equal(EMBEDPDF_STOCK_HIGHLIGHT_OPACITY, 1);
  assert.equal(isEmbedPdfStockHighlight("#FFCD45", 1), true);
  assert.equal(isEmbedPdfStockHighlight("#ffcd45", 1), true);
  assert.equal(isEmbedPdfStockHighlight("#FFCD45", 0.4), true);
  assert.equal(isEmbedPdfStockHighlight("#FFE566", 1), true);
  assert.equal(isEmbedPdfStockHighlight("#FFE566", 0.3), false);
  assert.equal(isEmbedPdfStockHighlight("#FFF59D", 0.4), false);
});

test("highlightStyleOf remaps EmbedPDF stock defaults to paper-aware style", () => {
  assert.deepEqual(
    highlightStyleOf({ color: "#FFCD45", opacity: 1 }, "dark"),
    HIGHLIGHT_BY_PAPER.dark,
  );
  assert.deepEqual(
    highlightStyleOf({ strokeColor: "#FFCD45", opacity: 1 }, "normal"),
    HIGHLIGHT_BY_PAPER.normal,
  );
  // Opaque non-stock colour keeps hue; opacity becomes paper default.
  assert.deepEqual(highlightStyleOf({ color: "#FF6B6B", opacity: 1 }, "dark"), {
    color: "#FF6B6B",
    opacity: HIGHLIGHT_BY_PAPER.dark.opacity,
  });
});

test("displayHighlightAppearance remaps stock sidecar paint on dark paper", () => {
  assert.deepEqual(
    displayHighlightAppearance({ color: "#FFCD45", opacity: 1 }, "dark"),
    HIGHLIGHT_BY_PAPER.dark,
  );
  assert.deepEqual(
    displayHighlightAppearance({ color: "#ffcd45", opacity: 1 }, "normal"),
    HIGHLIGHT_BY_PAPER.normal,
  );
  // Legacy 0.45 still migrates on dark; colour unchanged.
  assert.deepEqual(
    displayHighlightAppearance({ color: "#FFE566", opacity: 0.45 }, "dark"),
    { color: "#FFE566", opacity: 0.18 },
  );
  // Healthy #482 dark write passes through.
  assert.deepEqual(
    displayHighlightAppearance({ color: "#FFF59D", opacity: 0.4 }, "dark"),
    { color: "#FFF59D", opacity: 0.4 },
  );
});
