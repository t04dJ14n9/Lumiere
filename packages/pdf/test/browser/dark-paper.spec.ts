/**
 * Dark paper on a real page. The dark page is two PDFium renders made into one
 * (src/webview/dark-render.ts, src/shared/dark-page.ts): it relies on PDFium
 * leaving pictures opaque and drawing everything else in the colour scheme's
 * near-transparent ink. The unit tests use a fake engine, so this reads the
 * pixels the viewer shows for figure.pdf (test/fixtures/make-fixtures.mjs), a
 * diagram and a chart like the ones PDFium's colour scheme alone made
 * unreadable: a black label on a light box came out the colour of the box,
 * and every bar of a chart one colour.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openView, send } from "./view-controls-support";

/** [left, bottom, right, top] in PDF points, up from the bottom. */
type Rect = readonly [number, number, number, number];

interface Figure {
  size: { width: number; height: number };
  box: Rect;
  label: Rect;
  bars: { red: Rect; blue: Rect; green: Rect };
  picture: Rect;
  paper: Rect;
}

type Rgb = [number, number, number];

interface Area {
  mean: Rgb;
  lightest: Rgb;
  /** Pixels on a 6 x 4 grid across the area, row by row. */
  grid: Rgb[];
}

const DARK_PAPER: Rgb = [0x1e, 0x1e, 0x1e];

async function figure(): Promise<Figure> {
  const fixtures = pathToFileURL(
    path.join(__dirname, "..", "fixtures", "make-fixtures.mjs"),
  ).href;
  return ((await import(fixtures)) as { FIGURE: Figure }).FIGURE;
}

const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The colours of `areas` in the page's full picture (not the low-quality one
 * shown first), or null while there is none.
 */
function read(
  page: Page,
  size: Figure["size"],
  areas: Rect[],
): Promise<Area[] | null> {
  return page.evaluate(
    ({ size, areas }) => {
      const image = document.querySelector<HTMLImageElement>(
        ".page img.page-image:not(.page-image-low)",
      );
      if (!image?.complete || image.naturalWidth === 0) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const scaleX = canvas.width / size.width;
      const scaleY = canvas.height / size.height;
      const lum = ([r, g, b]: number[]) =>
        0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      return areas.map(([left, bottom, right, top]) => {
        const x = Math.round(left * scaleX);
        const y = Math.round((size.height - top) * scaleY);
        const width = Math.max(1, Math.round((right - left) * scaleX));
        const height = Math.max(1, Math.round((top - bottom) * scaleY));
        const { data } = context.getImageData(x, y, width, height);
        const pixel = (at: number): [number, number, number] => [
          data[at]!,
          data[at + 1]!,
          data[at + 2]!,
        ];
        const sum: [number, number, number] = [0, 0, 0];
        let lightest = pixel(0);
        for (let at = 0; at < data.length; at += 4) {
          const rgb = pixel(at);
          sum[0] += rgb[0];
          sum[1] += rgb[1];
          sum[2] += rgb[2];
          if (lum(rgb) > lum(lightest)) {
            lightest = rgb;
          }
        }
        const count = data.length / 4;
        const grid: [number, number, number][] = [];
        for (let row = 0; row < 4; row++) {
          for (let column = 0; column < 6; column++) {
            const gx = Math.floor(((column + 0.5) / 6) * width);
            const gy = Math.floor(((row + 0.5) / 4) * height);
            grid.push(pixel((gy * width + gx) * 4));
          }
        }
        return {
          mean: sum.map((value) => Math.round(value / count)) as [
            number,
            number,
            number,
          ],
          lightest,
          grid,
        };
      });
    },
    { size, areas },
  );
}

/** Wait until the full picture's bare paper is `paper`, then read `areas`. */
async function readOnPaper(
  page: Page,
  shape: Figure,
  paper: Rgb,
  areas: Rect[],
): Promise<Area[]> {
  let found: Area[] | null = null;
  await expect
    .poll(
      async () => {
        found = await read(page, shape.size, [shape.paper, ...areas]);
        const mean = found?.[0]?.mean;
        return (
          mean !== undefined &&
          mean.every((channel, index) => Math.abs(channel - paper[index]!) <= 2)
        );
      },
      { message: `the page is drawn on paper ${paper.join(",")}` },
    )
    .toBe(true);
  return found!.slice(1);
}

test("dark paper keeps a diagram and a chart readable and leaves pictures as authored", async ({
  page,
}) => {
  const shape = await figure();
  await page.setViewportSize({ width: 1100, height: 800 });
  await openView(page, {}, "slim", "&pdf=figure.pdf");
  const [normalPicture] = await readOnPaper(
    page,
    shape,
    [255, 255, 255],
    [shape.picture],
  );

  await send(page, { type: "pageColors", effective: "dark" });
  const [box, label, red, blue, green, picture] = await readOnPaper(
    page,
    shape,
    DARK_PAPER,
    [
      shape.box,
      shape.label,
      shape.bars.red,
      shape.bars.blue,
      shape.bars.green,
      shape.picture,
    ],
  );

  // The black label is light ink on the box, which still shows on the paper.
  expect(
    luminance(label!.lightest) - luminance(box!.mean),
    `label ${label!.lightest} on box ${box!.mean}`,
  ).toBeGreaterThan(100);
  expect(
    luminance(box!.mean) - luminance(DARK_PAPER),
    `box ${box!.mean}`,
  ).toBeGreaterThan(8);

  // Each bar keeps its hue, so the bars stay apart.
  const [r, g, b] = [red!.mean, green!.mean, blue!.mean];
  expect(r[0] - Math.max(r[1], r[2]), `red bar ${r}`).toBeGreaterThan(40);
  expect(g[1] - Math.max(g[0], g[2]), `green bar ${g}`).toBeGreaterThan(40);
  expect(b[2] - Math.max(b[0], b[1]), `blue bar ${b}`).toBeGreaterThan(40);

  // The picture is the same pixels as on white paper.
  picture!.grid.forEach((pixel, index) => {
    const authored = normalPicture!.grid[index]!;
    const apart = Math.max(
      ...pixel.map((channel, at) => Math.abs(channel - authored[at]!)),
    );
    expect(
      apart,
      `picture pixel ${index}: ${pixel} vs ${authored}`,
    ).toBeLessThanOrEqual(3);
  });
});
