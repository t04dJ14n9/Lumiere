import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdownLanguageSupport } from "../../markdown/dialect";
import { isHeadingLine, menuContext, menuHasSelection } from "./menu-context";

test("a word the browser selected on a macOS secondary click counts before CodeMirror reads it", () => {
  assert.equal(
    menuHasSelection({ isInContent: true, isCollapsed: false }, true),
    true,
  );
});

test("Vim character-visual: CodeMirror's range counts when the DOM caret is collapsed (BH-048)", () => {
  assert.equal(
    menuHasSelection({ isInContent: true, isCollapsed: true }, false),
    true,
  );
});

test("without a browser selection in the content, CodeMirror's selection decides", () => {
  assert.equal(menuHasSelection(null, false), true);
  assert.equal(menuHasSelection(null, true), false);
  assert.equal(
    menuHasSelection({ isInContent: false, isCollapsed: false }, true),
    false,
  );
  assert.equal(
    menuHasSelection({ isInContent: false, isCollapsed: true }, false),
    true,
  );
  assert.equal(
    menuHasSelection({ isInContent: true, isCollapsed: true }, true),
    false,
  );
});

test("the menu context shadows the global selection key", () => {
  assert.deepEqual(JSON.parse(menuContext(true)), {
    webviewSection: "markdownContent",
    "lumiere.markdown.hasSelection": true,
    "lumiere.markdown.selectionOnHeading": false,
  });
  assert.deepEqual(JSON.parse(menuContext(false, true)), {
    webviewSection: "markdownContent",
    "lumiere.markdown.hasSelection": false,
    "lumiere.markdown.selectionOnHeading": true,
  });
});

test("Rename Heading is offered on an ATX heading line, not on code, tags or other lines", () => {
  const doc = [
    "# Title",
    "text",
    "```",
    "# not a heading",
    "```",
    "#tag",
    "   ## Indented",
    "    # code",
    "#",
    "- # in a list",
  ].join("\n");
  const state = EditorState.create({
    doc,
    extensions: [markdownLanguageSupport()],
  });
  const lines = doc.split("\n").map((_, index) => {
    const line = state.doc.line(index + 1);
    return isHeadingLine(state, line.to);
  });
  assert.deepEqual(lines, [
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
  ]);
});

test("Rename Heading is offered on a heading the parse has not reached yet", () => {
  // A state is created with only its first few thousand characters parsed
  // (CodeMirror's initial viewport), so this heading, about 20 kB in, is only
  // found if the check finishes the parse up to its line. Small enough that
  // the parse stays far inside isHeadingLine's time budget on a busy runner.
  const filler = Array.from({ length: 2_000 }, (_, i) => `line ${i}`);
  const doc = [...filler, "# Far heading"].join("\n\n");
  const state = EditorState.create({
    doc,
    extensions: [markdownLanguageSupport()],
  });
  assert.equal(isHeadingLine(state, state.doc.length), true);
});
