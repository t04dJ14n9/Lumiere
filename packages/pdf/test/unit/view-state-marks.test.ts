import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_NOTE_LENGTH,
  parseViewState,
  parseViewerAction,
} from "../../src/shared/view-state";
import { DEFAULT_VIEW_CHOICES } from "../../src/shared/view-settings";

const baseView = {
  page: 1,
  pageCount: 3,
  zoomPercent: 100,
  fit: null,
  tool: "text",
  canGoBack: false,
  canGoForward: true,
  readingPage: 1,
  zoom: 1,
  top: 0,
  left: 0,
  ...DEFAULT_VIEW_CHOICES,
};

test("a view reporting the removed Annotate tool reads as text", () => {
  assert.equal(parseViewState({ ...baseView, tool: "annotate" })?.tool, "text");
  assert.equal(parseViewState({ ...baseView, tool: "region" })?.tool, "region");
});

test("the Annotate actions are gone", () => {
  for (const action of [
    { action: "setTool", tool: "annotate" },
    { action: "setAnnotationTool", tool: "highlight" },
    { action: "setAnnotationColor", color: "#FFE566" },
  ]) {
    assert.equal(parseViewerAction(action), undefined, JSON.stringify(action));
  }
});

test("markSelection takes a text tool and an optional note", () => {
  assert.deepEqual(
    parseViewerAction({ action: "markSelection", tool: "highlight" }),
    { action: "markSelection", tool: "highlight" },
  );
  assert.deepEqual(
    parseViewerAction({
      action: "markSelection",
      tool: "highlight",
      note: "check this",
    }),
    { action: "markSelection", tool: "highlight", note: "check this" },
  );
  assert.equal(
    parseViewerAction({ action: "markSelection", tool: "ink" }),
    undefined,
  );
  assert.equal(
    parseViewerAction({ action: "markSelection", tool: "highlight", note: 3 }),
    undefined,
  );
  assert.equal(
    parseViewerAction({
      action: "markSelection",
      tool: "highlight",
      note: "x".repeat(MAX_NOTE_LENGTH + 1),
    }),
    undefined,
  );
});

test("setMarkNote takes any note, empty to remove it; setMarkColor a preset", () => {
  assert.deepEqual(parseViewerAction({ action: "setMarkNote", note: "" }), {
    action: "setMarkNote",
    note: "",
  });
  assert.equal(parseViewerAction({ action: "setMarkNote" }), undefined);
  assert.deepEqual(
    parseViewerAction({ action: "setMarkColor", color: "#FF6B6B" }),
    { action: "setMarkColor", color: "#FF6B6B" },
  );
  assert.equal(
    parseViewerAction({ action: "setMarkColor", color: "#123456" }),
    undefined,
  );
  assert.deepEqual(parseViewerAction({ action: "annotationUndo" }), {
    action: "annotationUndo",
  });
});
