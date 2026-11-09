import assert from "node:assert/strict";
import { test } from "node:test";
import type { TextLayout } from "@embedpdf/engine";
import { charBounds, charBox, unionBounds } from "../../src/webview/text-boxes";

const box = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});
const corners = (left: number, top: number, right: number, bottom: number) => ({
  upperLeft: { x: left, y: top },
  upperRight: { x: right, y: top },
  lowerLeft: { x: left, y: bottom },
  lowerRight: { x: right, y: bottom },
});

/**
 * Five characters: "a", a space, "b" (tight box smaller than its cell), a
 * character with no box, and "c" in a run turned a quarter.
 */
const layout = {
  charCount: 5,
  runs: [
    {
      start: 0,
      rect: box(0, 0, 30, 10),
      glyphs: [
        { loose: box(0, 0, 8, 10), tight: box(1, 2, 6, 6) },
        { loose: box(8, 0, 2, 10), space: true as const },
        { loose: box(10, 0, 8, 10), tight: box(11, 2, 5, 6) },
        { loose: box(0, 0, 0, 0), empty: true as const },
      ],
    },
    {
      start: 4,
      rect: box(40, 0, 10, 20),
      rotation: 90,
      ascentFlip: false,
      glyphs: [
        { loose: corners(40, 0, 50, 20), tight: corners(41, 2, 49, 18) },
      ],
    },
  ],
} as unknown as TextLayout;

test("a character's box is the one hugging its shape; a space and a character with no box have none", () => {
  assert.deepEqual(charBox(layout, 0), [1, 2, 7, 8]);
  assert.equal(charBox(layout, 1), undefined);
  assert.deepEqual(charBox(layout, 2), [11, 2, 16, 8]);
  assert.equal(charBox(layout, 3), undefined);
  assert.equal(charBox(layout, 99), undefined);
});

test("a turned run's box is the bounds of its cell", () => {
  assert.deepEqual(charBox(layout, 4), [41, 2, 49, 18]);
});

test("every character of the page has a slot, boxes only where something is drawn", () => {
  assert.deepEqual(charBounds(layout), [
    [1, 2, 7, 8],
    undefined,
    [11, 2, 16, 8],
    undefined,
    [41, 2, 49, 18],
  ]);
});

test("a box with no area is not drawn", () => {
  const flat = {
    charCount: 1,
    runs: [
      { start: 0, rect: box(0, 0, 5, 0), glyphs: [{ loose: box(0, 0, 5, 0) }] },
    ],
  } as unknown as TextLayout;
  assert.deepEqual(charBounds(flat), [undefined]);
});

test("boxes are joined into the box around them", () => {
  assert.deepEqual(
    unionBounds([box(10, 5, 20, 10), box(0, 8, 5, 20)]),
    [0, 5, 30, 28],
  );
  assert.equal(unionBounds([]), undefined);
});
