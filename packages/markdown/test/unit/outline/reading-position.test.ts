import assert from "node:assert/strict";
import test from "node:test";
import type { EditorView } from "@codemirror/view";
import { readingOffset } from "../../../src/plugins/outline/reading-position";

type LineBlock = { from: number; top: number; bottom: number };

/**
 * Stub EditorView for readingOffset: document-relative line blocks and a
 * viewport rect. Heights are document Y (same space as lineBlockAtHeight).
 */
function viewStub(options: {
  documentTop?: number;
  viewportTop: number;
  viewportBottom: number;
  lines: LineBlock[];
}): EditorView {
  const documentTop = options.documentTop ?? 0;
  const lines = [...options.lines].sort((a, b) => a.top - b.top);
  const lineAtHeight = (height: number): LineBlock => {
    for (const line of lines) {
      if (height < line.bottom) {
        return line;
      }
    }
    return lines.at(-1) ?? { from: 0, top: 0, bottom: 0 };
  };
  return {
    documentTop,
    scrollDOM: {
      getBoundingClientRect: () => ({
        top: options.viewportTop + documentTop,
        bottom: options.viewportBottom + documentTop,
      }),
    },
    lineBlockAtHeight: (height: number) => lineAtHeight(height),
  } as unknown as EditorView;
}

test("readingOffset uses the top-of-viewport line when the caret is lower in view", () => {
  // Viewport 0–200; top line at 0, another line fully visible in the lower half.
  const view = viewStub({
    viewportTop: 0,
    viewportBottom: 200,
    lines: [
      { from: 0, top: 0, bottom: 20 },
      { from: 10, top: 20, bottom: 40 },
      { from: 20, top: 100, bottom: 120 },
      { from: 50, top: 160, bottom: 180 },
    ],
  });
  assert.equal(
    readingOffset(view),
    0,
    "must report the top line, not a lower on-screen line",
  );
});

test("readingOffset prefers the top line over the middle of the viewport", () => {
  // Middle of 0–300 is 150 → line from 40; top-of-viewport is line from 0.
  const view = viewStub({
    viewportTop: 0,
    viewportBottom: 300,
    lines: [
      { from: 0, top: 0, bottom: 20 },
      { from: 40, top: 140, bottom: 160 },
      { from: 80, top: 280, bottom: 300 },
      { from: 999, top: 500, bottom: 520 },
    ],
  });
  assert.equal(
    readingOffset(view),
    0,
    "must use top-of-viewport, not (top+bottom)/2",
  );
});

test("readingOffset returns a sane offset for an empty or short document", () => {
  const empty = viewStub({
    viewportTop: 0,
    viewportBottom: 400,
    lines: [{ from: 0, top: 0, bottom: 0 }],
  });
  assert.equal(readingOffset(empty), 0);

  const short = viewStub({
    viewportTop: 0,
    viewportBottom: 400,
    lines: [{ from: 0, top: 0, bottom: 24 }],
  });
  assert.equal(readingOffset(short), 0);
});

test("readingOffset tracks the line at the scrolled top, not a caret above the viewport", () => {
  // Scrolled so document Y 200–400 is visible; an earlier line is above.
  const view = viewStub({
    viewportTop: 200,
    viewportBottom: 400,
    lines: [
      { from: 0, top: 0, bottom: 20 },
      { from: 100, top: 200, bottom: 220 },
      { from: 150, top: 300, bottom: 320 },
    ],
  });
  assert.equal(readingOffset(view), 100);
});
