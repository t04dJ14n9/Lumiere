/**
 * What dark paper must do to figure.pdf (test/fixtures/make-fixtures.mjs),
 * checked on page pictures: the unit test's real PDFium renders and the
 * browser spec's viewer picture use the same rules.
 */
// Types only: Playwright cannot load the .mjs module statically, so each
// test loads FIGURE itself and passes it in.
import type { FIGURE, FigureArea } from "../fixtures/make-fixtures.mjs";
import { DARK_PALETTE, type Rgb } from "../../src/shared/dark-page";

/** figure.pdf's page size and areas (FIGURE in make-fixtures.mjs). */
export type Figure = typeof FIGURE;

/** A page picture: RGBA rows, top first. */
export interface Picture {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

/** Perceived lightness (Rec. 709 weights), 0 to 255. */
export function luminance([red, green, blue]: Rgb): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The pixels of `area` of the figure page, row by row. */
function pixelsOf(
  picture: Picture,
  figure: Figure,
  [left, top, right, bottom]: FigureArea,
): { columns: number; pixels: Rgb[] } {
  const scaleX = picture.width / figure.size.width;
  const scaleY = picture.height / figure.size.height;
  const x0 = Math.round(left * scaleX);
  const y0 = Math.round(top * scaleY);
  const columns = Math.max(1, Math.round((right - left) * scaleX));
  const rows = Math.max(1, Math.round((bottom - top) * scaleY));
  const pixels: Rgb[] = [];
  for (let y = y0; y < y0 + rows; y++) {
    for (let x = x0; x < x0 + columns; x++) {
      const at = (y * picture.width + x) * 4;
      pixels.push([
        picture.data[at]!,
        picture.data[at + 1]!,
        picture.data[at + 2]!,
      ]);
    }
  }
  return { columns, pixels };
}

function mean(pixels: readonly Rgb[]): Rgb {
  const sum = [0, 0, 0];
  for (const pixel of pixels) {
    sum[0]! += pixel[0];
    sum[1]! += pixel[1];
    sum[2]! += pixel[2];
  }
  return [
    Math.round(sum[0]! / pixels.length),
    Math.round(sum[1]! / pixels.length),
    Math.round(sum[2]! / pixels.length),
  ];
}

function lightest(pixels: readonly Rgb[]): Rgb {
  return pixels.reduce((best, pixel) =>
    luminance(pixel) > luminance(best) ? pixel : best,
  );
}

/** How far the colour's own channel stands above the other two. */
function lead(colour: Rgb, channel: 0 | 1 | 2): number {
  return (
    colour[channel] - Math.max(...colour.filter((_, at) => at !== channel))
  );
}

/** The picture's colours of `area`, compared on a 6 x 4 grid. */
function gridOf(picture: Picture, figure: Figure, area: FigureArea): Rgb[] {
  const { columns, pixels } = pixelsOf(picture, figure, area);
  const rows = pixels.length / columns;
  const grid: Rgb[] = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 6; column++) {
      const x = Math.floor(((column + 0.5) / 6) * columns);
      const y = Math.floor(((row + 0.5) / 4) * rows);
      grid.push(pixels[y * columns + x]!);
    }
  }
  return grid;
}

/** The colour of the figure's bare paper. */
export function paperOf(picture: Picture, figure: Figure): Rgb {
  return mean(pixelsOf(picture, figure, figure.paper).pixels);
}

/**
 * What is wrong with `dark`, figure.pdf on dark paper, next to `white`, the
 * same page as authored at the same size. Empty when it is right.
 */
export function darkFigureProblems(
  dark: Picture,
  white: Picture,
  figure: Figure,
): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) {
      problems.push(problem);
    }
  };
  const paper = paperOf(dark, figure);
  check(
    paper.every(
      (channel, at) => Math.abs(channel - DARK_PALETTE.background[at]!) <= 2,
    ),
    `paper ${paper} is not the dark paper ${DARK_PALETTE.background}`,
  );
  const area = (rect: FigureArea) => pixelsOf(dark, figure, rect).pixels;
  // The bug this guards: PDFium's colour scheme alone painted the label the
  // colour of its box, so it vanished.
  const box = mean(area(figure.box));
  const label = lightest(area(figure.label));
  check(
    luminance(label) - luminance(box) > 100,
    `label ${label} does not stand out from its box ${box}`,
  );
  check(
    luminance(box) - luminance(paper) > 8,
    `box ${box} does not show on the paper ${paper}`,
  );
  // Thin black marks become light ink, not lost in the paper.
  for (const [name, rect] of [
    ["arrowhead", figure.arrowhead],
    ["rule", figure.rule],
  ] as const) {
    const ink = lightest(area(rect));
    check(
      luminance(ink) - luminance(paper) > 80,
      `${name} ${ink} is lost in the paper ${paper}`,
    );
  }
  // The scheme alone turned every bar one colour; each must keep its hue.
  const bars = figure.bars;
  for (const [name, rect, channel] of [
    ["red", bars.red, 0],
    ["green", bars.green, 1],
    ["blue", bars.blue, 2],
  ] as const) {
    const bar = mean(area(rect));
    check(lead(bar, channel) > 40, `the ${name} bar ${bar} lost its hue`);
  }
  // Pictures keep their authored colours on dark paper (the forced render
  // leaves them opaque): the same pixels as on white paper.
  if (dark.width !== white.width || dark.height !== white.height) {
    problems.push(
      `the renders differ in size: ${dark.width}x${dark.height} and ${white.width}x${white.height}`,
    );
    return problems;
  }
  const authored = gridOf(white, figure, figure.picture);
  gridOf(dark, figure, figure.picture).forEach((pixel, at) => {
    const apart = Math.max(
      ...pixel.map((channel, index) =>
        Math.abs(channel - authored[at]![index]!),
      ),
    );
    check(
      apart <= 3,
      `picture pixel ${at} is ${pixel}, authored ${authored[at]}`,
    );
  });
  return problems;
}
