import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANNOTATE_IDLE_TOOL_ID,
  ANNOTATION_TOOL_IDS,
  LUMIA_ANNOTATION_TOOLS,
  READ_TOOL_ID,
  fromV3ToolId,
  isAnnotateModeTool,
  toV3ToolId,
  toolColorDefaults,
} from "../../src/shared/annotation-tools";

test("Lumia's tool ids map to EmbedPDF 3's at the boundary and back", () => {
  assert.equal(toV3ToolId("textComment"), "note");
  assert.equal(toV3ToolId("freeText"), "free-text");
  for (const id of [
    "highlight",
    "underline",
    "ink",
    "square",
    "stamp",
  ] as const) {
    assert.equal(toV3ToolId(id), id);
  }
  for (const tool of ANNOTATION_TOOL_IDS) {
    assert.equal(fromV3ToolId(toV3ToolId(tool)), tool);
  }
  assert.equal(fromV3ToolId("pointer"), null);
  assert.equal(fromV3ToolId(READ_TOOL_ID), null);
  assert.equal(fromV3ToolId("note"), "textComment");
  assert.equal(fromV3ToolId("textComment"), null);
  assert.equal(fromV3ToolId(null), null);
});

test("Annotate mode is a drawing tool or the resting tool, never View's read tool", () => {
  assert.equal(isAnnotateModeTool(ANNOTATE_IDLE_TOOL_ID), true);
  assert.equal(isAnnotateModeTool("highlight"), true);
  assert.equal(isAnnotateModeTool("free-text"), true);
  assert.equal(isAnnotateModeTool(READ_TOOL_ID), false);
  assert.equal(isAnnotateModeTool("pan"), false);
  assert.equal(isAnnotateModeTool(null), false);
});

test("the arrow is a line tool with an open arrowhead at its end", () => {
  const arrow = LUMIA_ANNOTATION_TOOLS.find((tool) => tool.id === "lineArrow");
  assert.equal(arrow?.extends, "line");
  assert.deepEqual(arrow?.defaults.lineEndings, {
    start: "none",
    end: "open-arrow",
  });
  assert.equal(toV3ToolId("lineArrow"), "lineArrow");
});

test("a colour pick sets the field its tool draws with", () => {
  assert.deepEqual(toolColorDefaults("highlight", "#4DABF7", "normal"), {
    color: "#4DABF7",
    opacity: 0.3,
    blendMode: "multiply",
  });
  for (const tool of [
    "underline",
    "ink",
    "square",
    "lineArrow",
    "textComment",
  ] as const) {
    assert.deepEqual(toolColorDefaults(tool, "#51CF66", "normal"), {
      color: "#51CF66",
    });
  }
  assert.deepEqual(toolColorDefaults("freeText", "#51CF66", "dark"), {
    color: "#51CF66",
    fontColor: "#51CF66",
  });
  assert.deepEqual(toolColorDefaults("stamp", "#51CF66", "normal"), {});
});
