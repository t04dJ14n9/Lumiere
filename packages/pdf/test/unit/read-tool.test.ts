import assert from "node:assert/strict";
import { test } from "node:test";
import { READ_TOOL_ID } from "../../src/shared/annotation-tools";
import { readTool } from "../../src/webview/annotation-mode";

test("View mode pans empty page space without enabling annotation edits", () => {
  const tool = readTool();
  assert.equal(tool.id, READ_TOOL_ID);
  assert.equal(tool.cursor, "default");
  assert.ok(tool.enables.has("text-select"), "dragging text still selects");
  assert.ok(
    tool.enables.has("link-nav"),
    "citation and page links stay clickable",
  );
  assert.ok(
    tool.enables.has("scroll"),
    "empty-page drag is Stage pan in continuous scrolling",
  );
  assert.ok(
    !tool.enables.has("annotation-edit"),
    "reading must not select, move or delete marks",
  );
  assert.ok(!tool.enables.has("annotation-marquee"));
});
