import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Both paper themes: EmbedPDF's text selection wraps line boxes in
 * `mix-blend-mode: multiply; isolation: isolate`. Multiply only tints where it
 * overlaps light glyph ink, so boxes look short/shifted — the same class of
 * bug sidecar highlights already fix with `mix-blend-mode: normal`. Light and
 * dark share normal blend + descender pad; colors differ via tokens only.
 */
function pageCss(): string {
  return readFileSync(
    new URL("../../src/webview/styles/page.css", import.meta.url),
    "utf8",
  );
}

test("both themes force text selection wrappers to mix-blend-mode normal", () => {
  const css = pageCss();
  // Shared (not dark-only) rule on the EmbedPDF isolation wrapper; inline
  // multiply must lose. Anchor on the isolation attribute selector so a
  // sidecar dark rule above with mix-blend-mode cannot satisfy this assert
  // across rule boundaries.
  assert.match(
    css,
    /\.page \[style\*="isolation:\s*isolate"\][^{]*\{[^}]*mix-blend-mode:\s*normal\s*!important/u,
  );
  // No dark-only selection-paint path for the isolation wrapper.
  assert.doesNotMatch(
    css,
    /#root\[data-page-colors="dark"\][^{]*\[style\*="isolation:\s*isolate"\][^{]*\{[^}]*mix-blend-mode:\s*normal/u,
  );
});

test("selection wrappers are translucent so glyphs stay readable on both themes", () => {
  const css = pageCss();
  // Opacity on the shared isolation rule: solid fill + normal would cover ink.
  assert.match(
    css,
    /\.page \[style\*="isolation:\s*isolate"\][^{]*\{[^}]*opacity:\s*0\.45/u,
  );
});

test("selection children expand vertically to cover descenders on both themes", () => {
  const css = pageCss();
  // Painted boxes use loose PDFium bounds that undershoot g/p/y ink; shared
  // scaleY on isolation children grows the cover downward for light and dark.
  assert.match(
    css,
    /\.page \[style\*="isolation:\s*isolate"\]\s*>\s*\*[^{]*\{[^}]*transform:\s*scaleY\(1\.28\)/u,
  );
  assert.match(
    css,
    /\.page \[style\*="isolation:\s*isolate"\]\s*>\s*\*[^{]*\{[^}]*transform-origin:\s*top\s+center/u,
  );
  assert.doesNotMatch(
    css,
    /#root\[data-page-colors="dark"\][^{]*\[style\*="isolation:\s*isolate"\]\s*>\s*\*[^{]*\{[^}]*transform:\s*scaleY/u,
  );
});
