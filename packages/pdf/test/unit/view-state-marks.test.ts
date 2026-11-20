import assert from "node:assert/strict";
import { test } from "node:test";
import { parseViewState, parseViewerAction } from "../../src/shared/view-state";
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

test("markSelection takes one of the four text marks, and nothing else", () => {
  for (const tool of ["highlight", "underline", "strikeout", "squiggly"]) {
    assert.deepEqual(parseViewerAction({ action: "markSelection", tool }), {
      action: "markSelection",
      tool,
    });
  }
  assert.equal(
    parseViewerAction({ action: "markSelection", tool: "ink" }),
    undefined,
  );
  // A note no longer rides along (Add Annotation is gone); it is dropped.
  assert.deepEqual(
    parseViewerAction({
      action: "markSelection",
      tool: "highlight",
      note: "x",
    }),
    { action: "markSelection", tool: "highlight" },
  );
});

test("Edit Note asks the viewer to open the note, which it carries no text for; setMarkColor takes a preset", () => {
  assert.deepEqual(parseViewerAction({ action: "editMarkNote" }), {
    action: "editMarkNote",
  });
  // The note is written in the viewer's own card now, not sent from a prompt.
  assert.equal(
    parseViewerAction({ action: "setMarkNote", note: "x" }),
    undefined,
  );
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
