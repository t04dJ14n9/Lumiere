import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Dark paper: EmbedPDF's text selection wraps line boxes in
 * `mix-blend-mode: multiply; isolation: isolate`. Multiply only tints where it
 * overlaps light glyph ink, so boxes look short/shifted on dark paper — the
 * same class of bug sidecar highlights already fix with `mix-blend-mode: normal`.
 */
function pageCss(): string {
  return readFileSync(
    new URL("../../src/webview/styles/page.css", import.meta.url),
    "utf8",
  );
}

test("dark paper forces text selection wrappers to mix-blend-mode normal", () => {
  const css = pageCss();
  // Match a dark-paper rule that targets the EmbedPDF isolation wrapper and
  // sets blend to normal (inline multiply must lose).
  // Anchor on the isolation attribute selector so a sidecar dark rule above
  // with mix-blend-mode cannot satisfy this assert across rule boundaries.
  assert.match(
    css,
    /#root\[data-page-colors="dark"\][^{]*\[style\*="isolation:\s*isolate"\][^{]*\{[^}]*mix-blend-mode:\s*normal\s*!important/u,
  );
});
