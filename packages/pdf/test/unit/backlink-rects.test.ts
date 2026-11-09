import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageTextSnapshot } from "@embedpdf/engine";
import { backlinkRects } from "../../src/webview/backlink-rects";

const GLYPH_WIDTH = 8;
const LINE_HEIGHT = 14;

/**
 * A page as PDFium lists its characters: a line break is "\r\n" and "~" is
 * the marker it counts for a hyphen joined at a line end. EmbedPDF's page
 * text drops the "\r" and the marker, and its character map says where.
 */
function pageOf(characters: string): PageTextSnapshot {
  let text = "";
  const charMap: [number, number][] = [];
  [...characters].forEach((character, index) => {
    const piece = character === "~" || character === "\r" ? "" : character;
    text += piece;
    if (piece.length !== 1) {
      charMap.push([index + 1, text.length]);
    }
  });
  return {
    text,
    charCount: characters.length,
    ...(charMap.length > 0 ? { charMap } : {}),
  };
}

/**
 * The layout of those characters, one box per character laid out in lines
 * (none for whitespace and the marker), merging a range into one segment per
 * line as EmbedPDF's layout does.
 */
function layoutOf(characters: string) {
  let line = 0;
  let column = 0;
  const cells = [...characters].map((character) => {
    const at = { line, column };
    column += 1;
    if (character === "\n") {
      line += 1;
      column = 0;
    }
    return /[\s~]/u.test(character) ? undefined : at;
  });
  return {
    segments: (range: { start: number; count: number }) => {
      const lines = new Map<number, number[]>();
      for (const cell of cells.slice(range.start, range.start + range.count)) {
        if (cell) {
          lines.set(cell.line, [...(lines.get(cell.line) ?? []), cell.column]);
        }
      }
      return [...lines].map(([row, columns]) => ({
        rect: {
          x: Math.min(...columns) * GLYPH_WIDTH,
          y: row * LINE_HEIGHT,
          width:
            (Math.max(...columns) + 1 - Math.min(...columns)) * GLYPH_WIDTH - 1,
          height: LINE_HEIGHT - 2,
        },
        quad: {},
        advance: 1 as const,
      }));
    },
  };
}

const CHARACTERS =
  "Scaled dot-product attention is a\r\nmechanism for infor~mation retrieval that works\r\nwell.";

test("a quote across a hyphenated line end is boxed from where its words really are", () => {
  const rects = backlinkRects(
    pageOf(CHARACTERS),
    layoutOf(CHARACTERS) as never,
    {
      textStart: "information retrieval that works well.",
    },
  );
  assert.ok(rects);
  // "infor~mation retrieval that works" is the rest of line 1, "well." line 2.
  assert.equal(rects.length, 2);
  const second = CHARACTERS.split("\r\n")[1]!;
  assert.equal(rects[0]!.x, second.indexOf("infor") * GLYPH_WIDTH);
  assert.equal(rects[0]!.y, LINE_HEIGHT);
  assert.equal(
    rects[0]!.w,
    (second.length - second.indexOf("infor")) * GLYPH_WIDTH - 1,
  );
  assert.deepEqual(rects[1], {
    x: 0,
    y: 2 * LINE_HEIGHT,
    w: "well.".length * GLYPH_WIDTH - 1,
    h: LINE_HEIGHT - 2,
  });
});

test("the match ignores case and the line breaks of the page", () => {
  const rects = backlinkRects(
    pageOf(CHARACTERS),
    layoutOf(CHARACTERS) as never,
    {
      textStart: "DOT-PRODUCT attention is a mechanism",
    },
  );
  assert.equal(rects?.length, 2);
  assert.equal(rects![0]!.x, "Scaled ".length * GLYPH_WIDTH);
});

test("a quote that is not on the page has no boxes", () => {
  assert.equal(
    backlinkRects(pageOf(CHARACTERS), layoutOf(CHARACTERS) as never, {
      textStart: "something else entirely",
    }),
    undefined,
  );
});

// A selection from the end of one page into the start of the next: Copy link
// writes the whole quote into the link of each page, so a page holds one end.
const QUOTE =
  "The quick brown fox jumps over the lazy dog and keeps running far away from here.";
const END_OF_PAGE =
  "Some earlier paragraph text.\r\nThe quick brown fox jumps over\r\nthe lazy dog and keeps";

test("the part of a quote that crosses a page break is boxed at the page's edge", () => {
  const rects = backlinkRects(
    pageOf(END_OF_PAGE),
    layoutOf(END_OF_PAGE) as never,
    {
      textStart: QUOTE,
    },
  );
  assert.equal(rects?.length, 2);
  assert.equal(rects![0]!.y, LINE_HEIGHT);
  assert.equal(rects![1]!.w, "the lazy dog and keeps".length * GLYPH_WIDTH - 1);
});

test("a passage named by its two ends is not cut at a page edge", () => {
  assert.equal(
    backlinkRects(pageOf(END_OF_PAGE), layoutOf(END_OF_PAGE) as never, {
      textStart: "The quick brown fox",
      textEnd: "never on this page",
    }),
    undefined,
  );
});

test("the end of a quote is boxed at the start of its next page", () => {
  const next =
    "running far away from here.\r\nA new paragraph begins on this page.";
  assert.deepEqual(
    backlinkRects(pageOf(next), layoutOf(next) as never, { textStart: QUOTE }),
    [
      {
        x: 0,
        y: 0,
        w: "running far away from here.".length * GLYPH_WIDTH - 1,
        h: LINE_HEIGHT - 2,
      },
    ],
  );
});

test("a quote that is whole on the page is boxed whole, not as an edge", () => {
  const page = `Before.\r\n${QUOTE.replace("jumps over the", "jumps over\r\nthe")}\r\nAfter.`;
  const rects = backlinkRects(pageOf(page), layoutOf(page) as never, {
    textStart: QUOTE,
  });
  assert.equal(rects?.length, 2);
  assert.equal(rects![0]!.y, LINE_HEIGHT);
  assert.equal(
    rects![1]!.w,
    "the lazy dog and keeps running far away from here.".length * GLYPH_WIDTH -
      1,
  );
});

test("a passage named by its two ends is boxed from the one to the other", () => {
  const rects = backlinkRects(
    pageOf(CHARACTERS),
    layoutOf(CHARACTERS) as never,
    {
      textStart: "dot-product",
      textEnd: "INFORMATION",
    },
  );
  assert.equal(rects?.length, 2);
  assert.equal(rects![0]!.x, "Scaled ".length * GLYPH_WIDTH);
});

test("a passage whose characters have no boxes is not drawn", () => {
  assert.equal(
    backlinkRects(
      pageOf("boxless text"),
      { segments: () => [] },
      {
        textStart: "text",
      },
    ),
    undefined,
  );
});
