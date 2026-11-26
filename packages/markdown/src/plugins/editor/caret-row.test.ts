import assert from "node:assert/strict";
import test from "node:test";
import { isPlausibleRow } from "./caret-geometry";
import { isSingleRow } from "./selection-rows";

test("a two-row line counts as two rows even when its glyphs are as tall as a row", () => {
  // A table cell: line-height 20.8 px, two wrapped rows, a 21 px CJK glyph.
  assert.equal(isSingleRow(42, 20.8, 21), false);
  assert.equal(isSingleRow(20.8, 20.8, 21), true);
  // A list row made taller by inline code stays one row.
  assert.equal(isSingleRow(26.4, 24, 18), true);
  // No CSS line-height: the glyph stands in.
  assert.equal(isSingleRow(30, undefined, 24), true);
  assert.equal(isSingleRow(48, undefined, 24), false);
});

test("the caret takes a row band only when it is one row around the glyph", () => {
  const glyph = { top: 100, bottom: 121 };
  assert.equal(isPlausibleRow({ top: 98, bottom: 123 }, glyph), true);
  // Two merged rows: taller than 1.8 glyphs.
  assert.equal(isPlausibleRow({ top: 98, bottom: 140 }, glyph), false);
  // A band on another row.
  assert.equal(isPlausibleRow({ top: 130, bottom: 150 }, glyph), false);
});
