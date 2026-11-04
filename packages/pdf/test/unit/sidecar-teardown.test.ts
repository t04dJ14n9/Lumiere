import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("viewerPlugins no longer registers sidecarHighlightTool", () => {
  const source = readFileSync(
    path.join(root, "src/webview/plugins.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /sidecarHighlightTool/);
  assert.doesNotMatch(source, /sidecar-highlight-tool/);
  const body = source.slice(source.indexOf("export function viewerPlugins"));
  assert.match(body, /AnnotationPluginPackage/);
  assert.doesNotMatch(body, /tools:\s*\[/);
});

test("mark-selection drops sidecar highlight writing", () => {
  const source = readFileSync(
    path.join(root, "src/webview/mark-selection.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /useSidecarHighlightWriting/);
  assert.doesNotMatch(source, /sidecar-writing/);
});

test("page no longer paints SidecarHighlightLayer", () => {
  const source = readFileSync(path.join(root, "src/webview/page.tsx"), "utf8");
  assert.doesNotMatch(source, /SidecarHighlightLayer/);
  assert.doesNotMatch(source, /sidecar-layer/);
});
