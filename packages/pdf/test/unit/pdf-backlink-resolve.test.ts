import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { shouldDeleteAnnotationOnKey } from "../../src/shared/annotation-delete-keys";
import type { GlyphBox } from "../../src/shared/sidecar-reattach";
import { resolveTextToLineRects } from "../../src/shared/pdf-backlink-resolve";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("resolveTextToLineRects maps first exact match to line rects", () => {
  const pageText = "aa Synthetic page 1 bb";
  // Parallel glyph boxes (undefined for spaces), same length as pageText.
  const glyphBoxes: (GlyphBox | undefined)[] = Array.from(pageText, (ch, i) => {
    if (ch === " ") {
      return undefined;
    }
    const x = 10 + i * 8;
    return [x, 100, x + 7, 112] as GlyphBox;
  });
  const rects = resolveTextToLineRects(pageText, glyphBoxes, "Synthetic");
  assert.ok(rects);
  assert.equal(rects!.length, 1);
  assert.equal(rects![0]!.x, 10 + pageText.indexOf("Synthetic") * 8);
  assert.equal(rects![0]!.y, 100);
  assert.ok(rects![0]!.w > 0);
  assert.equal(rects![0]!.h, 12);
});

test("resolveTextToLineRects soft-fails when textStart is missing", () => {
  const pageText = "Synthetic page 1";
  const glyphBoxes: GlyphBox[] = Array.from(pageText, (_, i) => {
    const x = 10 + i * 8;
    return [x, 100, x + 7, 112] as GlyphBox;
  });
  assert.equal(
    resolveTextToLineRects(pageText, glyphBoxes, "Missing"),
    undefined,
  );
});

test("resolveTextToLineRects uses the first occurrence only", () => {
  const pageText = "foo bar foo";
  const glyphBoxes: (GlyphBox | undefined)[] = Array.from(pageText, (ch, i) => {
    if (ch === " ") {
      return undefined;
    }
    const x = i * 10;
    const y = i < 4 ? 10 : 40;
    return [x, y, x + 8, y + 10] as GlyphBox;
  });
  const rects = resolveTextToLineRects(pageText, glyphBoxes, "foo");
  assert.ok(rects);
  assert.equal(rects![0]!.x, 0);
  assert.equal(rects![0]!.y, 10);
});

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
