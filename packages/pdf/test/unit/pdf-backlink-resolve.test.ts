import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { shouldDeleteAnnotationOnKey } from "../../src/shared/annotation-delete-keys";

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

test("overlays never enter mark-selection / never set hasAnnotationSelection", () => {
  const markSelection = readFileSync(
    path.join(root, "src/webview/mark-selection.ts"),
    "utf8",
  );
  // No store/selection imports or hooks for overlays — only a doc comment is allowed.
  assert.doesNotMatch(markSelection, /from ["'][^"']*backlink[^"']*["']/);
  assert.doesNotMatch(
    markSelection,
    /useBacklink|rememberBacklink|selectBacklink|pdfBacklink/i,
  );
  // Del with no annotation selection (overlay-only click path) is a no-op.
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Delete",
      annotate: true,
      hasAnnotationSelection: false,
      editable: false,
    }),
    false,
  );
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Backspace",
      annotate: true,
      hasAnnotationSelection: false,
      editable: false,
    }),
    false,
  );
});
