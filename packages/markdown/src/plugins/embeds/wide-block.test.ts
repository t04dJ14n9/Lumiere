import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "embeds.css"),
  "utf8",
);

test("Live Preview image-embed allows overflow-x for wide images", () => {
  assert.match(css, /\.image-embed[^{]*\{[^}]*overflow-x\s*:\s*auto/s);
});

test("Live Preview image shrinks to the line's width, as in Obsidian", () => {
  // The owner chose shrink-to-fit on 2026-11-09, replacing #446's natural
  // width + sideways scroll for images: Obsidian's editor caps images at the
  // line (.markdown-source-view.mod-cm6 img { max-width: 100% }), so a wide
  // flowchart is seen whole instead of cut off at the pane's edge.
  // Mermaid diagrams still keep their size and scroll, as in Obsidian.
  assert.match(css, /\.image-embed\s+img\s*\{[^}]*max-width\s*:\s*100%/s);
  assert.doesNotMatch(
    css,
    /\.image-embed\s+img\s*\{[^}]*max-width\s*:\s*none/s,
  );
});

test("Live Preview image-embed is pane-constrained so overflow-x can scroll", () => {
  // Host must stay within the pane (max-width:100%, width:100%, or contain)
  // so overflow-x engages instead of growing the note. Keep inline-block so
  // selection-inline / remount height stay green.
  const withoutInspector = css.replace(
    /\.image-inspector[\s\S]*?(?=\n\/\*|\n\.file-embed|\n\.pdf-embed|$)/,
    "",
  );
  const hosts = [
    ...withoutInspector.matchAll(/\.image-embed\s*\{[^}]*\}/g),
  ].map((m) => m[0]);
  assert.ok(hosts.length >= 1);
  for (const rule of hosts) {
    const constrained =
      /contain\s*:\s*inline-size/.test(rule) ||
      /width\s*:\s*100%/.test(rule) ||
      /max-width\s*:\s*100%/.test(rule);
    assert.equal(constrained, true, rule);
  }
});
