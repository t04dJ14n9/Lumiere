import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANNOTATION_COLORS,
  MARK_TOOL_IDS,
  isAnnotationColor,
  isMarkToolId,
  markColorPatch,
} from "../../src/shared/annotation-tools";

test("selected text can be highlighted, underlined, struck out or squiggled", () => {
  assert.deepEqual(MARK_TOOL_IDS, [
    "highlight",
    "underline",
    "strikeout",
    "squiggly",
  ]);
  for (const removed of ["ink", "square", "stamp", "freeText", "lineArrow"]) {
    assert.equal(isMarkToolId(removed), false, removed);
  }
});

test("Change Color offers six named colours, yellow first", () => {
  assert.deepEqual(
    ANNOTATION_COLORS.map((color) => color.label),
    ["Yellow", "Red", "Blue", "Green", "Purple", "Black"],
  );
  assert.ok(isAnnotationColor("#FFE566"));
  assert.equal(isAnnotationColor("red"), false);
});

test("a colour pick sets the field a mark of each kind draws with", () => {
  assert.deepEqual(markColorPatch("highlight", "#4DABF7", "normal"), {
    color: "#4DABF7",
    opacity: 0.3,
    blendMode: "multiply",
  });
  assert.deepEqual(markColorPatch("highlight", "#4DABF7", "dark"), {
    color: "#4DABF7",
    opacity: 0.4,
    blendMode: "normal",
  });
  // Marks made before Annotate mode was removed are still recoloured.
  for (const subtype of ["underline", "ink", "square", "line", "text"]) {
    assert.deepEqual(markColorPatch(subtype, "#51CF66", "normal"), {
      color: "#51CF66",
    });
  }
  assert.deepEqual(markColorPatch("free-text", "#51CF66", "dark"), {
    color: "#51CF66",
    fontColor: "#51CF66",
  });
  assert.deepEqual(markColorPatch("stamp", "#51CF66", "normal"), {});
});
