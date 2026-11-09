import assert from "node:assert/strict";
import { test } from "node:test";
import { ANNOTATION_COLOR_PRESETS } from "../../src/shared/annotation-tools";
import {
  HIGHLIGHT_BY_PAPER,
  highlightStyleForPaper,
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

test("status-bar yellow preset matches light-paper highlight", () => {
  assert.equal(ANNOTATION_COLOR_PRESETS[0], HIGHLIGHT_BY_PAPER.normal.color);
});

test("highlightToolDefaults and highlightStyleForPaper follow paper mode", () => {
  // Light paper multiplies the mark into the page; dark paper needs `normal`,
  // which EmbedPDF 3 stores in the annotation.
  assert.deepEqual(highlightToolDefaults("normal"), {
    color: "#FFE566",
    opacity: 0.3,
    blendMode: "multiply",
  });
  assert.deepEqual(highlightToolDefaults("dark"), {
    color: "#FFF59D",
    opacity: 0.4,
    blendMode: "normal",
  });
  assert.deepEqual(highlightToolDefaults("dark", "#4DABF7"), {
    color: "#4DABF7",
    opacity: 0.4,
    blendMode: "normal",
  });
  assert.deepEqual(highlightStyleForPaper("dark"), HIGHLIGHT_BY_PAPER.dark);
});
