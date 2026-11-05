import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { EditorView } from "@codemirror/view";
import {
  CARET_SCROLL_MS,
  READING_REPORT_MS,
  ReadingReporter,
  readingOffset,
} from "../../../src/plugins/outline/reading-position";

type LineBlock = { from: number; top: number; bottom: number };

/**
 * Stub EditorView for readingOffset: document-relative line blocks and a
 * viewport rect. Heights are document Y (same space as lineBlockAtHeight).
 * `inset` is the embedder's `--lumiere-inset-top`; `sticky` the sticky
 * overlay, whose `bottom` is document Y too.
 */
function viewStub(options: {
  documentTop?: number;
  viewportTop: number;
  viewportBottom: number;
  lines: LineBlock[];
  inset?: number;
  sticky?: { bottom: number; hidden?: boolean };
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
  const sticky = options.sticky && {
    hidden: options.sticky.hidden ?? false,
    getBoundingClientRect: () => ({
      bottom: (options.sticky?.bottom ?? 0) + documentTop,
    }),
  };
  return {
    documentTop,
    scrollDOM: {
      clientTop: 0,
      getBoundingClientRect: () => ({
        top: options.viewportTop + documentTop,
        bottom: options.viewportBottom + documentTop,
      }),
    },
    dom: {
      ownerDocument: {
        documentElement: {},
        defaultView: {
          getComputedStyle: () => ({
            getPropertyValue: () =>
              options.inset === undefined ? "" : `${options.inset}px`,
          }),
        },
      },
      querySelector: (selector: string) =>
        selector === ".mw-sticky-scroll" ? (sticky ?? null) : null,
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

test("readingOffset reads below the sticky headings, not under them", () => {
  // A jump put "## Nested" (from 200) right below two pinned parents. The
  // lines under the pins belong to the section before it.
  const lines = [
    { from: 100, top: 200, bottom: 220 },
    { from: 150, top: 220, bottom: 240 },
    { from: 200, top: 240, bottom: 260 },
    { from: 250, top: 260, bottom: 280 },
  ];
  const pinned = viewStub({
    viewportTop: 200,
    viewportBottom: 400,
    lines,
    sticky: { bottom: 240 },
  });
  assert.equal(readingOffset(pinned), 200);

  const unpinned = viewStub({ viewportTop: 200, viewportBottom: 400, lines });
  assert.equal(readingOffset(unpinned), 100, "no pins: the top line");

  const hidden = viewStub({
    viewportTop: 200,
    viewportBottom: 400,
    lines,
    sticky: { bottom: 240, hidden: true },
  });
  assert.equal(readingOffset(hidden), 100, "a hidden overlay covers nothing");
});

test("readingOffset reads below the embedder's controls", () => {
  const lines = [
    { from: 0, top: 0, bottom: 20 },
    { from: 10, top: 20, bottom: 40 },
    { from: 20, top: 40, bottom: 60 },
    { from: 30, top: 60, bottom: 80 },
  ];
  const covered = viewStub({
    viewportTop: 0,
    viewportBottom: 200,
    lines,
    inset: 48,
  });
  assert.equal(readingOffset(covered), 20, "48px of controls hide two lines");

  const none = viewStub({ viewportTop: 0, viewportBottom: 200, lines });
  assert.equal(readingOffset(none), 0);
});

test("readingOffset reads below whichever of the controls and the pins reaches lower", () => {
  const lines = [
    { from: 0, top: 0, bottom: 20 },
    { from: 10, top: 20, bottom: 40 },
    { from: 20, top: 40, bottom: 60 },
    { from: 30, top: 60, bottom: 80 },
  ];
  const view = (inset: number, bottom: number) =>
    viewStub({
      documentTop: 30,
      viewportTop: 0,
      viewportBottom: 200,
      lines,
      inset,
      sticky: { bottom },
    });
  assert.equal(readingOffset(view(48, 30)), 20, "controls reach lower");
  assert.equal(readingOffset(view(10, 70)), 30, "pins reach lower");
});

/** A reporter whose reader is at `position.offset`, with timers under test control. */
function reporterAt(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const position = { offset: 0 };
  const reports: number[] = [];
  const reporter = new ReadingReporter({
    read: () => position.offset,
    report: (offset) => reports.push(offset),
  });
  t.after(() => reporter.dispose());
  return {
    reporter,
    position,
    reports,
    tick: t.mock.timers.tick.bind(t.mock.timers),
  };
}

test("a scroll the reader makes is reported once it pauses", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  position.offset = 40;
  reporter.scrolled();
  tick(READING_REPORT_MS - 1);
  assert.deepEqual(reports, [], "still scrolling");
  tick(1);
  assert.deepEqual(reports, [40]);
  // Stopped where it was reported: nothing new to say.
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [40]);
});

test("a scroll the caret caused does not override the caret follow", (t) => {
  // Arrow-down past the bottom, Page Down, Ctrl+End, find next: the caret
  // moved and the editor scrolled to keep it in view. The caret follow
  // selected the caret's section; the top line is not where the reader is.
  const { reporter, position, reports, tick } = reporterAt(t);
  position.offset = 10;
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [10]);

  reporter.caretMoved();
  tick(30);
  position.offset = 500;
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [10], "the caret's scroll is not reported");
});

test("a caret scroll that spans several frames stays the caret's", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  reporter.caretMoved();
  for (const offset of [100, 200, 300]) {
    position.offset = offset;
    reporter.scrolled();
    tick(40);
  }
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, []);
});

test("the caret's scroll is remembered: a layout shift to the same top line is not news", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  reporter.caretMoved();
  position.offset = 500;
  reporter.scrolled();
  tick(READING_REPORT_MS);
  // Much later (an image above finishes loading), the scroller fires again
  // with the same line on top.
  tick(5000);
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, []);
});

test("the reader scrolling soon after the caret scroll is reported", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  reporter.caretMoved();
  position.offset = 500;
  reporter.scrolled();
  tick(CARET_SCROLL_MS);
  // The caret's scroll is over; the reader takes the wheel.
  tick(1);
  position.offset = 900;
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [900]);
});

test("a scroll that mixes the caret's and the reader's is reported", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  reporter.caretMoved();
  position.offset = 500;
  reporter.scrolled();
  tick(CARET_SCROLL_MS - 50);
  // Still scrolling when the caret's window closes.
  position.offset = 700;
  reporter.scrolled();
  tick(60);
  position.offset = 800;
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [800]);
});

test("a caret move supersedes a reader scroll still waiting to be reported", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  position.offset = 300;
  reporter.scrolled();
  tick(READING_REPORT_MS - 10);
  // The reader pressed a key just before the report: the caret is newer.
  reporter.caretMoved();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, []);
});

test("a caret move makes the same position reportable again", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  position.offset = 40;
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [40]);
  // The caret moved without scrolling, then the reader scrolls back to the
  // line it reported: the outline is on the caret's section now.
  reporter.caretMoved();
  tick(CARET_SCROLL_MS + 1);
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [40, 40]);
});

test("an edit makes the same position reportable again", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  position.offset = 40;
  reporter.scrolled();
  tick(READING_REPORT_MS);
  reporter.documentChanged();
  reporter.scrolled();
  tick(READING_REPORT_MS);
  assert.deepEqual(reports, [40, 40]);
});

test("a stopped reporter sends nothing", (t) => {
  const { reporter, position, reports, tick } = reporterAt(t);
  position.offset = 40;
  reporter.scrolled();
  reporter.dispose();
  tick(READING_REPORT_MS * 2);
  assert.deepEqual(reports, []);
});
