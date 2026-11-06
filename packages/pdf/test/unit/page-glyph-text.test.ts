import assert from "node:assert/strict";
import { test } from "node:test";
import { foldText } from "../../src/shared/page-text-fold";
import {
  alignGlyphText,
  STRIPPED_GLYPH,
} from "../../src/shared/page-glyph-text";
import { resolveTextToLineRects } from "../../src/shared/pdf-backlink-resolve";
import { GLYPH_WIDTH, layOut } from "./support/page-text";

/**
 * What PDFium and EmbedPDF gave for a page whose second line ends in a
 * hyphenated word (read with the real engine): "~" is the U+FFFE marker
 * PDFium counts as a glyph and EmbedPDF strips from the text. Only the
 * glyph list is a character longer than the text.
 */
const GLYPHS =
  "Scaled dot-product attention is a\r\nmechanism for infor~mation retrieval that works\r\nwell.";

function glyphTexts(): string[] {
  return Array.from(GLYPHS, (char) => (char === "~" ? "" : char));
}

test("a stripped glyph keeps its place as a character that folds away", () => {
  const aligned = alignGlyphText(glyphTexts(), layOut(GLYPHS));
  assert.equal(aligned.text.length, GLYPHS.length);
  assert.equal(aligned.boxes.length, GLYPHS.length);
  assert.equal(aligned.text[GLYPHS.indexOf("~")], STRIPPED_GLYPH);
  assert.equal(foldText(STRIPPED_GLYPH).text, "");
  assert.ok(foldText(aligned.text).text.includes("information retrieval"));
});

test("with the text aligned, a rect sits over the glyphs of its words", () => {
  const boxes = layOut(GLYPHS);
  const aligned = alignGlyphText(glyphTexts(), boxes);
  const rects = resolveTextToLineRects(
    aligned.text,
    aligned.boxes,
    "retrieval that works well.",
  );
  assert.ok(rects);
  // "retrieval that works" ends the second line; "well." is the third.
  const second = GLYPHS.split("\r\n")[1]!;
  assert.equal(rects.length, 2);
  assert.equal(rects[0]!.x, second.indexOf("retrieval") * GLYPH_WIDTH);
  assert.equal(rects[1]!.x, 0);
  assert.equal(rects[1]!.w, "well.".length * GLYPH_WIDTH - 1);
});

test("text read in one piece, one short, would put the rect a glyph off", () => {
  const boxes = layOut(GLYPHS);
  const stripped = glyphTexts().join("");
  const drifted = resolveTextToLineRects(stripped, boxes, "well.");
  const aligned = alignGlyphText(glyphTexts(), boxes);
  const right = resolveTextToLineRects(aligned.text, aligned.boxes, "well.");
  assert.ok(drifted && right);
  assert.notDeepEqual(drifted, right);
});

test("a glyph of two UTF-16 units lends its box to both", () => {
  const aligned = alignGlyphText(
    ["a", "\u{1f600}", "b"],
    [
      [10, 0, 17, 12],
      [0, 0, 7, 12],
      [20, 0, 27, 12],
    ],
  );
  assert.equal(aligned.text, "a\u{1f600}b");
  assert.equal(aligned.boxes.length, aligned.text.length);
  assert.deepEqual(aligned.boxes[1], aligned.boxes[2]);
  assert.deepEqual(aligned.boxes[3], [20, 0, 27, 12]);
});
