import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("page layer order lists AnnotationLayer before BacklinkLayer in source", () => {
  const src = readFileSync(path.join(root, "src/webview/page.tsx"), "utf8");
  assert.ok(src.includes("<AnnotationLayer"));
  assert.ok(src.includes("<BacklinkLayer"));
  assert.ok(
    src.indexOf("<AnnotationLayer") < src.indexOf("<BacklinkLayer"),
    "AnnotationLayer must precede BacklinkLayer in JSX",
  );
});

test("overlays never become the context menu's mark", () => {
  const markMenu = readFileSync(
    path.join(root, "src/webview/mark-menu.ts"),
    "utf8",
  );
  // Marks come from EmbedPDF's annotations only: no backlink store or hooks.
  assert.doesNotMatch(markMenu, /from ["'][^"']*backlink[^"']*["']/);
  assert.doesNotMatch(
    markMenu,
    /useBacklink|rememberBacklink|selectBacklink|pdfBacklink/i,
  );
});
