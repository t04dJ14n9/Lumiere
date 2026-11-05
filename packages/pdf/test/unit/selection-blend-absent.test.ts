import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Negative lock for PR #503 / revert of #490: EmbedPDF SelectionLayer must
 * keep shipped multiply + isolation. Do not reintroduce the #490 overrides
 * that forced normal blend, group opacity, or scaleY descender pad on the
 * isolation wrappers. Sidecar/backlink may still use mix-blend-mode:normal
 * and opacity:0.45 — asserts anchor on the isolation attribute selector so
 * those unrelated rules cannot satisfy (or break) this lock.
 */
function pageCss(): string {
  return readFileSync(
    new URL("../../src/webview/styles/page.css", import.meta.url),
    "utf8",
  );
}

/** Matches `.page [style*="isolation: isolate"]` / `isolation:isolate`. */
const isolationWrapper =
  /\.page\s+\[style\*="isolation:\s*isolate"\][^{]*\{[^}]*\}/u;
const isolationChild =
  /\.page\s+\[style\*="isolation:\s*isolate"\]\s*>\s*\*[^{]*\{[^}]*\}/u;

test("page.css has no #490 SelectionLayer isolation wrapper overrides", () => {
  const css = pageCss();
  // Deleted #490 block:
  //   .page [style*="isolation: isolate"], .page [style*="isolation:isolate"] {
  //     mix-blend-mode: normal !important;
  //     opacity: 0.45;
  //   }
  assert.doesNotMatch(
    css,
    /\.page \[style\*="isolation:\s*isolate"\][^{]*\{[^}]*mix-blend-mode:\s*normal\s*!important/u,
  );
  assert.doesNotMatch(
    css,
    /\.page \[style\*="isolation:\s*isolate"\][^{]*\{[^}]*opacity:\s*0\.45/u,
  );
  // Broader: no isolation-wrapper rule block at all for SelectionLayer.
  assert.doesNotMatch(css, isolationWrapper);
});

test("page.css has no #490 SelectionLayer isolation child scaleY overrides", () => {
  const css = pageCss();
  // Deleted #490 block:
  //   .page [style*="isolation: isolate"] > *, .page [style*="isolation:isolate"] > * {
  //     transform: scaleY(1.32);
  //     transform-origin: top center;
  //   }
  assert.doesNotMatch(
    css,
    /\.page \[style\*="isolation:\s*isolate"\]\s*>\s*\*[^{]*\{[^}]*transform:\s*scaleY\(1\.32\)/u,
  );
  assert.doesNotMatch(css, isolationChild);
});
