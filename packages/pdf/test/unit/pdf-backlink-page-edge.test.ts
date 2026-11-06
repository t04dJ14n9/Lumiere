import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findQuoteAtPageEdge,
  MIN_EDGE_CHARS,
} from "../../src/shared/pdf-backlink-page-edge";
import { resolveTextToLineRects } from "../../src/shared/pdf-backlink-resolve";
import { GLYPH_WIDTH, layOut, LINE_HEIGHT } from "./support/page-text";

// A selection from the end of one page into the start of the next. Copy link
// writes the whole quote into the link of each page (agent-text.ts), so a
// page holds only one end of it.
const QUOTE =
  "The quick brown fox jumps over the lazy dog and keeps running far away from here.";
const END_OF_PAGE =
  "Some earlier paragraph text.\r\nThe quick brown fox jumps over\r\nthe lazy dog and keeps";
const START_OF_NEXT =
  "running far away from here.\r\nA new paragraph begins on this page.";

test("the beginning of a quote is painted at the end of its first page", () => {
  const rects = resolveTextToLineRects(END_OF_PAGE, layOut(END_OF_PAGE), QUOTE);
  assert.ok(rects);
  assert.equal(rects.length, 2);
  // "The quick brown fox jumps over" is line 1, "the lazy dog and keeps" 2.
  assert.deepEqual(rects[0], {
    x: 0,
    y: LINE_HEIGHT,
    w: "The quick brown fox jumps over".length * GLYPH_WIDTH - 1,
    h: LINE_HEIGHT - 2,
  });
  assert.equal(rects[1]!.y, 2 * LINE_HEIGHT);
  assert.equal(rects[1]!.w, "the lazy dog and keeps".length * GLYPH_WIDTH - 1);
});

test("the ending of a quote is painted at the start of its next page", () => {
  const rects = resolveTextToLineRects(
    START_OF_NEXT,
    layOut(START_OF_NEXT),
    QUOTE,
  );
  assert.ok(rects);
  assert.deepEqual(rects, [
    {
      x: 0,
      y: 0,
      w: "running far away from here.".length * GLYPH_WIDTH - 1,
      h: LINE_HEIGHT - 2,
    },
  ]);
});

test("a footer and header between the two ends are part of the quote", () => {
  const footer = `${END_OF_PAGE}\r\n12`;
  const header = "Chapter 2\r\nrunning far away from here.\r\nMore text.";
  const quote = QUOTE.replace("keeps running", "keeps 12 Chapter 2 running");
  assert.deepEqual(findQuoteAtPageEdge(footer, quote), {
    start: footer.indexOf("The quick"),
    end: footer.length,
  });
  assert.deepEqual(findQuoteAtPageEdge(header, quote), {
    start: 0,
    end: header.indexOf("here.") + "here.".length,
  });
});

test("the longest part of the quote at the edge wins", () => {
  // The page ends with the quote's first four words and with its first eight.
  const quote = "one two three four one two three four five six";
  const page = "Preface. one two three four one two three four";
  assert.deepEqual(findQuoteAtPageEdge(page, quote), {
    start: "Preface. ".length,
    end: page.length,
  });
});

test("matching at the edge ignores case and line breaks", () => {
  const page = "Intro.\r\nTHE QUICK BROWN\r\nFOX JUMPS OVER THE LAZY\r\nDOG";
  const range = findQuoteAtPageEdge(page, QUOTE)!;
  assert.equal(
    page.slice(range.start, range.end),
    "THE QUICK BROWN\r\nFOX JUMPS OVER THE LAZY\r\nDOG",
  );
});

test("a page that the quote runs through is painted whole", () => {
  const middle = "the lazy dog and keeps\r\nrunning far away";
  const quote = `The quick brown fox jumps over ${middle.replace("\r\n", " ")} from here, on the next page.`;
  assert.deepEqual(findQuoteAtPageEdge(middle, quote), {
    start: 0,
    end: middle.length,
  });
});

test("a bit of the quote shorter than the minimum is left unpainted", () => {
  const quote = "alpha beta gamma delta epsilon zeta eta theta";
  const justEnough = quote.slice(0, MIN_EDGE_CHARS);
  assert.ok(findQuoteAtPageEdge(`Some words ${justEnough}`, quote));
  const tooShort = quote.slice(0, MIN_EDGE_CHARS - 1);
  assert.equal(findQuoteAtPageEdge(`Some words ${tooShort}`, quote), undefined);
  const justEnoughEnd = quote.slice(-MIN_EDGE_CHARS);
  assert.ok(findQuoteAtPageEdge(`${justEnoughEnd} and more`, quote));
  const tooShortEnd = quote.slice(-(MIN_EDGE_CHARS - 1));
  assert.equal(
    findQuoteAtPageEdge(`${tooShortEnd} and more`, quote),
    undefined,
  );
});

test("part of a quote in the middle of a page is not painted", () => {
  const page = `${END_OF_PAGE}\r\nand then the page goes on with other text.`;
  assert.equal(findQuoteAtPageEdge(page, QUOTE), undefined);
  assert.equal(
    findQuoteAtPageEdge(`Other text first. ${START_OF_NEXT}`, QUOTE),
    undefined,
  );
});

test("a page the quote has nothing to do with is left alone", () => {
  assert.equal(
    findQuoteAtPageEdge("Entirely different words on this page.", QUOTE),
    undefined,
  );
  assert.equal(findQuoteAtPageEdge("", QUOTE), undefined);
  assert.equal(findQuoteAtPageEdge(END_OF_PAGE, ""), undefined);
});

test("a quote that is whole on the page is matched whole, not as an edge", () => {
  const page = `Before.\r\n${QUOTE.replace("jumps over the", "jumps over\r\nthe")}\r\nAfter.`;
  const rects = resolveTextToLineRects(page, layOut(page), QUOTE);
  assert.ok(rects);
  assert.equal(rects.length, 2);
  assert.equal(rects[0]!.y, LINE_HEIGHT);
  // The second line is all of the rest of the quote, not an edge's worth.
  assert.equal(
    rects[1]!.w,
    "the lazy dog and keeps running far away from here.".length * GLYPH_WIDTH -
      1,
  );
});

test("a range link (textStart,textEnd) is not cut at a page edge", () => {
  assert.equal(
    resolveTextToLineRects(END_OF_PAGE, layOut(END_OF_PAGE), {
      textStart: QUOTE,
      textEnd: "from here.",
    }),
    undefined,
  );
});
