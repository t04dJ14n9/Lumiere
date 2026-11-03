/**
 * Dark paper in the viewer. test/unit/dark-page-engine.test.ts checks the
 * dark page PDFium and `darkenPage` make; this checks the picture the viewer
 * shows once the host switches page colors: the two renders combined, encoded
 * and swapped in for the white page (src/webview/dark-render.ts).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { DARK_PALETTE } from "../../src/shared/dark-page";
import { PAGE_COLORS_ENGINE_AVAILABLE } from "../../src/shared/page-colors-engine";
import {
  darkFigureProblems,
  paperOf,
  type Figure,
  type Picture,
} from "../support/dark-figure";
import { openView, send } from "./view-controls-support";

/**
 * The page's full picture (not the low-quality one shown first) as RGBA, or
 * null while there is none.
 */
async function shownPicture(page: Page): Promise<Picture | null> {
  const shown = await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>(
      ".page img.page-image:not(.page-image-low)",
    );
    if (!image?.complete || image.naturalWidth === 0) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    // Bytes as a string: page.evaluate would send a number array as JSON.
    let bytes = "";
    for (let at = 0; at < data.length; at += 0x8000) {
      bytes += String.fromCharCode(...data.subarray(at, at + 0x8000));
    }
    return { width: canvas.width, height: canvas.height, rgba: btoa(bytes) };
  });
  return (
    shown && {
      width: shown.width,
      height: shown.height,
      data: Buffer.from(shown.rgba, "base64"),
    }
  );
}

/**
 * figure.pdf's geometry. Playwright cannot load the fixture module
 * statically (it is an ES module that reads import.meta), so it is imported
 * here, typed by make-fixtures.d.mts.
 */
async function loadFigure(): Promise<Figure> {
  const fixtures = pathToFileURL(
    path.join(__dirname, "..", "fixtures", "make-fixtures.mjs"),
  ).href;
  return ((await import(fixtures)) as { FIGURE: Figure }).FIGURE;
}

/**
 * The full picture, once its bare paper is `paper`. Until then the viewer
 * still shows the page from before the switch, or only its low picture.
 */
async function pictureOnPaper(
  page: Page,
  figure: Figure,
  paper: readonly number[],
): Promise<Picture> {
  let picture: Picture | null = null;
  await expect
    .poll(
      async () => {
        picture = await shownPicture(page);
        return (
          picture !== null &&
          paperOf(picture, figure).every(
            (channel, at) => Math.abs(channel - paper[at]!) <= 2,
          )
        );
      },
      { message: `the page is drawn on paper ${paper.join(",")}` },
    )
    .toBe(true);
  return picture!;
}

test("dark paper keeps a diagram and a chart readable and leaves pictures as authored", async ({
  page,
}) => {
  test.skip(
    !PAGE_COLORS_ENGINE_AVAILABLE,
    "the EmbedPDF pageColors patch is off (src/shared/page-colors-engine.ts)",
  );
  const figure = await loadFigure();
  await page.setViewportSize({ width: 1100, height: 800 });
  await openView(page, {}, "slim", "&pdf=figure.pdf");
  const white = await pictureOnPaper(page, figure, [255, 255, 255]);
  await send(page, { type: "pageColors", effective: "dark" });
  const dark = await pictureOnPaper(page, figure, DARK_PALETTE.background);
  expect(darkFigureProblems(dark, white, figure)).toEqual([]);
});
