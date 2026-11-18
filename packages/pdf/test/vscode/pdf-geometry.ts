import { expect, type Frame, type Page } from "@playwright/test";

export const PAGE_WIDTH = 300;
const FIT_MARGIN = 48;

/**
 * Where every page box is and how big, as one string: it changes while the
 * view scrolls, zooms or turns, and not otherwise. The Stage has no scrolling
 * element to read, so a spec sees the view as the reader does, by its pages.
 */
export function pageLayout(viewer: Frame): Promise<string> {
  return viewer.evaluate(() =>
    Array.from(document.querySelectorAll(".page[data-page-index]"))
      .map((element) => {
        const box = element.getBoundingClientRect();
        return `${box.x}:${box.y}:${box.width}:${box.height}`;
      })
      .join(","),
  );
}

/**
 * How far down the document the viewer has been scrolled, in pixels (what a
 * scroller's `scrollTop` was), for pages of one size in a single column, as
 * the sample PDF's are. Pages come and go as the view moves, so it is the
 * place of the first mounted page from the top of the document, counted by
 * the distance between two mounted pages. Needs two pages mounted.
 */
export function scrolledDown(viewer: Frame): Promise<number> {
  return viewer.evaluate(() => {
    const view = document.querySelector(".viewport")!.getBoundingClientRect();
    const pages = Array.from(
      document.querySelectorAll<HTMLElement>(".page[data-page-index]"),
    )
      .map((element) => ({
        index: Number(element.dataset.pageIndex),
        top: element.getBoundingClientRect().top,
      }))
      .sort((a, b) => a.index - b.index);
    const [first, second] = pages;
    if (!first || !second) {
      return Number.NaN;
    }
    const step = (second.top - first.top) / (second.index - first.index);
    return first.index * step - (first.top - view.top);
  });
}

/**
 * How far the pages on screen reach past the viewer's width, in pixels (what
 * `scrollWidth - clientWidth` was, less the room around the pages): how far
 * the view can pan sideways.
 */
export function widthBeyondViewer(viewer: Frame): Promise<number> {
  return viewer.evaluate(() => {
    const view = document.querySelector(".viewport")!;
    const boxes = Array.from(
      document.querySelectorAll(".page[data-page-index]"),
    ).map((element) => element.getBoundingClientRect());
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.right));
    return right - left - view.clientWidth;
  });
}

/** How far the page box of 0-based `index` starts from the viewer's left edge (negative once panned past it). */
export function pageLeft(viewer: Frame, index: number): Promise<number> {
  return viewer.evaluate((index) => {
    const view = document.querySelector(".viewport")!.getBoundingClientRect();
    const page = document.querySelector(`.page[data-page-index="${index}"]`)!;
    return page.getBoundingClientRect().left - view.left;
  }, index);
}

/** Whether 1-based page `number` starts at the top of the viewer. */
export function pageAtTop(viewer: Frame, number: number): Promise<boolean> {
  return viewer.evaluate((index) => {
    const viewport = document
      .querySelector(".viewport")!
      .getBoundingClientRect();
    const page = document
      .querySelector(`.page[data-page-index="${index}"]`)
      ?.getBoundingClientRect();
    return Boolean(page) && Math.abs(page!.top - viewport.top) <= 16;
  }, number - 1);
}

/** Whether the point `top` PDF points down 1-based page `number` is at the top of the viewer. */
export function pointAtTop(
  viewer: Frame,
  number: number,
  top: number,
): Promise<boolean> {
  return viewer.evaluate(
    ([index, top, pageWidth]) => {
      const viewport = document
        .querySelector(".viewport")!
        .getBoundingClientRect();
      const page = document
        .querySelector(`.page[data-page-index="${index}"]`)
        ?.getBoundingClientRect();
      return (
        Boolean(page) &&
        Math.abs(page!.top + top * (page!.width / pageWidth) - viewport.top) <=
          2
      );
    },
    [number - 1, top, PAGE_WIDTH] as const,
  );
}

/**
 * Whether the first page fits inside the viewer at its current zoom, and fills
 * it in one direction (less the page margins), as fit page leaves it.
 */
export function pageFit(
  viewer: Frame,
): Promise<{ fitsWidth: boolean; fitsHeight: boolean; fills: boolean }> {
  return viewer.evaluate((margin) => {
    const viewport = document.querySelector(".viewport")!;
    const page = document
      .querySelector('.page[data-page-index="0"]')!
      .getBoundingClientRect();
    const { clientWidth: width, clientHeight: height } = viewport;
    return {
      fitsWidth: page.width <= width,
      fitsHeight: page.height <= height,
      fills: page.width >= width - margin || page.height >= height - margin,
    };
  }, FIT_MARGIN);
}

/**
 * A point given in PDF points on page `number`, both for the mouse (window
 * pixels) and inside the viewer frame (for `elementFromPoint`).
 */
export async function pagePoint(viewer: Frame, number: number) {
  const page = viewer.locator(`.page[data-page-index="${number - 1}"]`);
  const onScreen = (await page.boundingBox())!;
  const inFrame = await page.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y };
  });
  const scale = onScreen.width / PAGE_WIDTH;
  return (x: number, y: number) => ({
    screen: [onScreen.x + x * scale, onScreen.y + y * scale] as [
      number,
      number,
    ],
    frame: [inFrame.x + x * scale, inFrame.y + y * scale] as [number, number],
  });
}

/**
 * Give the webview the keyboard: a click on empty space beside the pages. The
 * viewer's own element cannot be focused (the Stage has no scroller, which a
 * browser would make a tab stop), so `focus()` on it does nothing.
 */
export async function focusViewer(page: Page, viewer: Frame): Promise<void> {
  // Measured afresh on each try: after a layout change (entering zen) VS Code
  // moves the webview a moment later, and a click where it was misses it.
  await expect(async () => {
    const box = (await viewer.locator(".viewport").boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + box.height / 2);
    await expect
      .poll(() => viewer.evaluate(() => document.hasFocus()), {
        timeout: 2_000,
      })
      .toBe(true);
  }).toPass({ timeout: 15_000 });
}

export type Point = { screen: [number, number]; frame: [number, number] };

export async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(...from.screen);
  await page.mouse.down();
  await page.mouse.move(...to.screen, { steps: 8 });
  await page.mouse.up();
}

/** Drag across text once the viewer shows a text cursor there, as a reader would. */
export async function selectText(
  page: Page,
  viewer: Frame,
  from: Point,
  to: Point,
): Promise<void> {
  // The cursor changes on pointer movement, so keep nudging while waiting.
  let nudge = 0;
  await expect
    .poll(async () => {
      nudge = 1 - nudge;
      await page.mouse.move(from.screen[0] + nudge, from.screen[1]);
      return viewer.evaluate(
        ([x, y]) =>
          getComputedStyle(document.elementFromPoint(x, y) as Element).cursor,
        from.frame,
      );
    })
    .toBe("text");
  await drag(page, from, to);
}
