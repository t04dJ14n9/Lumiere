import assert from "node:assert/strict";
import { test } from "node:test";
import type { Annotation, TextLayout } from "@embedpdf/engine-core/public";
import {
  quoteBoxes,
  readBoxesText,
  readRegionText,
  type RegionPage,
} from "../../src/shared/region-reader";

const quad = (left: number, top: number, right: number, bottom: number) => ({
  upperLeft: { x: left, y: top },
  upperRight: { x: right, y: top },
  lowerLeft: { x: left, y: bottom },
  lowerRight: { x: right, y: bottom },
});

test("a text mark's quads are boxes, one a line, whichever corner each point names", () => {
  const mark = {
    subtype: "highlight",
    quadPoints: [
      quad(10, 20, 110, 32),
      // A quad turned over: the same box.
      {
        upperLeft: { x: 90, y: 52 },
        upperRight: { x: 10, y: 52 },
        lowerLeft: { x: 90, y: 40 },
        lowerRight: { x: 10, y: 40 },
      },
    ],
  } as unknown as Annotation;
  assert.deepEqual(quoteBoxes(mark), [
    [10, 20, 110, 32],
    [10, 40, 90, 52],
  ]);
});

test("a mark without quads covers no text", () => {
  assert.deepEqual(
    quoteBoxes({
      subtype: "ink",
      rect: { x: 1, y: 2, width: 3, height: 4 },
    } as unknown as Annotation),
    [],
  );
});

/** "ab cd" on one line, ten points a character; the space has no box. */
const page: RegionPage = {
  layout: async () =>
    ({
      charCount: 5,
      runs: [
        {
          start: 0,
          rect: { x: 0, y: 0, width: 50, height: 10 },
          glyphs: [...Array(5).keys()].map((column) => ({
            loose: { x: column * 10, y: 0, width: 10, height: 10 },
            tight: { x: column * 10, y: 0, width: 10, height: 10 },
            ...(column === 2 ? { space: true as const } : {}),
          })),
        },
      ],
    }) as unknown as TextLayout,
  slice: async ({ start, count }) => "ab cd".slice(start, start + count),
};

test("the text of several boxes is joined with spaces", async () => {
  assert.equal(await readRegionText(page, [0, 0, 20, 10]), "ab");
  assert.equal(
    await readBoxesText(page, [
      [0, 0, 20, 10],
      [30, 0, 50, 10],
    ]),
    "ab cd",
  );
  assert.equal(await readBoxesText(page, []), "");
});

test("a page that cannot be read gives no text, whatever it is asked for", async () => {
  const refused: RegionPage = {
    layout: page.layout,
    slice: async () => {
      throw new Error("permission-denied");
    },
  };
  assert.equal(await readRegionText(refused, [0, 0, 50, 10]), "");
  assert.equal(await readBoxesText(refused, [[0, 0, 50, 10]]), "");
});
