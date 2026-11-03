import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DARK_PALETTE,
  darkColor,
  darkenPage,
  FORCED_PAGE_COLORS,
} from "../../src/shared/dark-page";

const luminance = ([r, g, b]: readonly number[]): number =>
  0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

/** RGBA pixels from colours; the forced render's pixels from alphas. */
const pixels = (...colours: [number, number, number][]): Uint8ClampedArray =>
  Uint8ClampedArray.from(colours.flatMap(([r, g, b]) => [r, g, b, 255]));
const forcedAlphas = (...alphas: number[]): Uint8ClampedArray =>
  Uint8ClampedArray.from(alphas.flatMap((alpha) => [232, 230, 227, alpha]));

test("white paper becomes the dark paper and black ink the light ink", () => {
  assert.deepEqual(darkColor(255, 255, 255), [...DARK_PALETTE.background]);
  assert.deepEqual(darkColor(0, 0, 0), [...DARK_PALETTE.ink]);
});

test("the lightness of grey flips, step by step", () => {
  const levels = [0, 64, 128, 192, 230, 255].map((grey) =>
    luminance(darkColor(grey, grey, grey)),
  );
  for (let at = 1; at < levels.length; at++) {
    assert.ok(levels[at]! < levels[at - 1]!, `grey step ${at} is darker`);
  }
});

// The reported bug: a node box (light grey fill) and its label (black text)
// came out one colour, so the label vanished.
test("a light box and the dark label on it stay apart", () => {
  const box = darkColor(230, 230, 230);
  const label = darkColor(0, 0, 0);
  assert.ok(luminance(label) - luminance(box) > 120, "the label stands out");
  assert.ok(
    luminance(box) - luminance(darkColor(255, 255, 255)) > 8,
    "the box still shows against the paper",
  );
});

test("colours keep their hue, so the bars of a chart stay distinct", () => {
  const red = darkColor(217, 51, 51);
  const blue = darkColor(51, 102, 217);
  const green = darkColor(51, 166, 77);
  assert.ok(red[0] > red[1] && red[0] > red[2], `red stays red: ${red}`);
  assert.ok(blue[2] > blue[0] && blue[2] > blue[1], `blue stays blue: ${blue}`);
  assert.ok(green[1] > green[0] && green[1] > green[2], `green: ${green}`);
  for (const [one, other] of [
    [red, blue],
    [red, green],
    [blue, green],
  ] as const) {
    const apart = Math.max(...one.map((c, i) => Math.abs(c - other[i]!)));
    assert.ok(apart > 40, `${one} and ${other} differ`);
  }
});

test("darkenPage inverts the page in place and leaves alpha alone", () => {
  const normal = pixels([255, 255, 255], [0, 0, 0], [230, 230, 230]);
  darkenPage(normal, forcedAlphas(0, 1, 1));
  assert.deepEqual(
    [...normal],
    [
      ...DARK_PALETTE.background,
      255,
      ...DARK_PALETTE.ink,
      255,
      ...darkColor(230, 230, 230),
      255,
    ],
  );
});

test("a pixel the forced render draws opaque is a picture and stays as it was", () => {
  const picture: [number, number, number] = [12, 200, 90];
  const normal = pixels([255, 255, 255], picture, [255, 255, 255]);
  darkenPage(normal, forcedAlphas(0, 255, 0));
  assert.deepEqual([...normal.slice(4, 8)], [...picture, 255]);
  assert.deepEqual([...normal.slice(0, 3)], [...DARK_PALETTE.background]);
  assert.deepEqual([...normal.slice(8, 11)], [...DARK_PALETTE.background]);
});

test("a run of one colour broken by a picture is still inverted on both sides", () => {
  const red: [number, number, number] = [217, 51, 51];
  const normal = pixels(red, red, [10, 10, 10], red, red);
  darkenPage(normal, forcedAlphas(1, 1, 255, 1, 1));
  const dark = darkColor(...red);
  for (const at of [0, 4, 12, 16]) {
    assert.deepEqual([...normal.slice(at, at + 3)], dark);
  }
  assert.deepEqual([...normal.slice(8, 11)], [10, 10, 10]);
});

test("the two renders must be the same size", () => {
  assert.throws(
    () => darkenPage(pixels([0, 0, 0]), forcedAlphas(1, 1)),
    RangeError,
  );
});

test("the forced render's ink is all but transparent, on a transparent page", () => {
  assert.equal(FORCED_PAGE_COLORS.background, "#00000000");
  for (const ink of [
    FORCED_PAGE_COLORS.pathFill,
    FORCED_PAGE_COLORS.pathStroke,
    FORCED_PAGE_COLORS.textFill,
    FORCED_PAGE_COLORS.textStroke,
  ]) {
    assert.match(ink, /^#01[0-9a-f]{6}$/, "alpha 1, never 0 or opaque");
  }
});
