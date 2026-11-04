import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** The value of `--selection-fill` in the viewer's stylesheet. */
function selectionFill(): string {
  const css = readFileSync(
    new URL("../../src/webview/styles/base.css", import.meta.url),
    "utf8",
  );
  const value = /--selection-fill:([^;]+);/u.exec(css)?.[1];
  assert.ok(value, "base.css defines --selection-fill");
  return value
    .replace(/\s+/gu, " ")
    .replace(/\( /gu, "(")
    .replace(/ \)/gu, ")")
    .trim();
}

test("the text selection fill is solid; group opacity prevents double-darkening", () => {
  // EmbedPDF draws one box per line inside an isolation wrapper. page.css
  // paints with mix-blend-mode: normal + wrapper opacity, so a solid fill
  // keeps overlaps from stacking while glyphs stay readable. The theme's
  // colour is made solid first: some themes' are see-through. Mix is strong
  // enough that the tint still reads after ~0.45 group opacity.
  const fill = selectionFill();
  assert.match(fill, /^color-mix\(in srgb, oklch\(.+ \/ 1\) 90%, white\)$/u);
});
