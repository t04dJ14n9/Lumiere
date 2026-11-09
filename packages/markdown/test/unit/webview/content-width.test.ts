import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = new URL("../../../", import.meta.url).pathname;
const base = readFileSync(
  path.join(root, "src/webview/styles/base.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/*
 * .cm-content is a flex item of .cm-scroller. With the default min-width
 * (auto) its width can never drop below its min-content width, so one wide
 * descendant (a 3000px image, an HTML <pre>, a fixed-width <div>) widened
 * the whole note: every paragraph and table wrapped at that width and ran
 * past the pane's right edge. A percentage max-width on the widget does not
 * help, because it does not cap the min-content contribution.
 */
test("one wide block cannot widen the note: .cm-content has min-width 0", () => {
  const content = /#app \.cm-content \{([^}]*)\}/.exec(base);
  assert.ok(content, "#app .cm-content rule");
  assert.match(content[1] ?? "", /(^|[;\s])min-width:\s*0(px)?\s*;/);
});
