import { expect, test, type Page } from "@playwright/test";
import { act, openView } from "./view-controls-support";

/**
 * Pages show a picture promptly and keep it: a page that comes into view (a
 * turn, a jump, scrolling) has its picture within a bound, never goes blank
 * again once it has one (a zoom step keeps the old picture until the sharper
 * one replaces it), and rests sharp. EmbedPDF draws the picture (a base plane
 * for the whole page and tiles over it where the view wants more pixels), and
 * only the pages of the view are mounted.
 */
interface Frame {
  at: number;
  shown: string;
  /** Pages in view without a loaded picture. */
  blank: number;
  /** The indexes of those pages. */
  blankPages: string[];
}

/** The pages on screen now. */
const shownNow = (page: Page): Promise<string> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".page[data-page-index]"))
      .map((p) => p.dataset.pageIndex)
      .join(","),
  );

/** Sample every animation frame for `ms`; the caller starts the gesture right after. */
function sample(page: Page, ms: number): Promise<Frame[]> {
  return page.evaluate(
    (ms) =>
      new Promise<Frame[]>((resolve) => {
        const frames: Frame[] = [];
        const start = performance.now();
        const tick = (): void => {
          const pages = Array.from(
            document.querySelectorAll<HTMLElement>(".page[data-page-index]"),
          );
          // Only pages in view can be seen blank: the ones mounted just outside
          // it are for the next scroll, and may be redrawn at a step.
          const view = document
            .querySelector(".viewport")!
            .getBoundingClientRect();
          const blankPages = pages
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.bottom > view.top && box.top < view.bottom;
            })
            .filter((element) => {
              // The whole-page picture is the page box's first child. A new
              // picture loads beside the old one, which stays on screen (and
              // keeps its width) until the new one is decoded: blank is no
              // picture at all.
              const image =
                element.querySelector<HTMLImageElement>(":scope > img");
              return !image || image.naturalWidth === 0;
            })
            .map((element) => element.dataset.pageIndex!);
          frames.push({
            at: performance.now() - start,
            shown: pages.map((p) => p.dataset.pageIndex).join(","),
            blank: blankPages.length,
            blankPages,
          });
          if (performance.now() - start < ms) {
            requestAnimationFrame(tick);
          } else {
            resolve(frames);
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/** Whether every picture on screen has dark pixels in it (the fixture pages have text). */
function painted(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLImageElement>(".page > img"),
    ).every((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 160;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 128) {
          return true;
        }
      }
      return false;
    }),
  );
}

/**
 * How many pages in view rest soft: neither the whole-page picture nor the
 * tiles over it have as many pixels as the screen shows (a tolerance of 5%
 * for rounding). Pages mounted just outside the view only need their picture.
 */
function softPages(page: Page): Promise<number> {
  return page.evaluate(() => {
    const dpr = window.devicePixelRatio;
    const view = document.querySelector(".viewport")!.getBoundingClientRect();
    return Array.from(
      document.querySelectorAll<HTMLElement>(".page[data-page-index]"),
    ).filter((element) => {
      const box = element.getBoundingClientRect();
      if (box.bottom <= view.top || box.top >= view.bottom) {
        return false;
      }
      const base = element.querySelector<HTMLImageElement>(":scope > img");
      if (base && base.naturalWidth >= box.width * dpr * 0.95) {
        return false;
      }
      const tiles = Array.from(
        element.querySelectorAll<HTMLImageElement>("img"),
      ).filter((image) => image !== base && image.naturalWidth > 0);
      return !(
        tiles.length > 0 &&
        tiles.every(
          (tile) =>
            tile.naturalWidth / tile.getBoundingClientRect().width >=
            dpr * 0.95,
        )
      );
    }).length;
  });
}

async function open(page: Page, view: object): Promise<void> {
  await page.setViewportSize({ width: 1100, height: 700 });
  await openView(page, view);
  await expect.poll(() => painted(page)).toBe(true);
  await expect.poll(() => softPages(page)).toBe(0);
}

/** The first frame at or after `from` with every page on screen painted. */
function firstPainted(frames: Frame[], from: number): Frame | undefined {
  return frames.slice(from).find((frame) => frame.blank === 0);
}

for (const pageLayout of ["single", "spread"] as const) {
  test(`${pageLayout}, page-by-page: a turn shows the new page's picture within a few frames and keeps it`, async ({
    page,
  }) => {
    await open(page, {
      scrollMode: "paged",
      pageLayout,
      defaultZoom: "fitPage",
    });
    const before = await shownNow(page);
    const frames = sample(page, 1_500);
    await page.keyboard.press("PageDown");
    const seen = await frames;
    const turned = seen.findIndex((frame) => frame.shown !== before);
    expect(turned, "the turn happened").toBeGreaterThan(-1);
    const first = firstPainted(seen, turned)!;
    expect(first, "a picture appeared").toBeTruthy();
    expect(first.at - seen[turned]!.at).toBeLessThan(400);
    // Once the pictures are there, no later frame is blank.
    expect(
      seen.filter((frame) => frame.at > first.at && frame.blank > 0).length,
    ).toBe(0);
    expect(await painted(page)).toBe(true);
    await expect.poll(() => softPages(page)).toBe(0);
  });
}

test("rapid turns, forward and back, end on the right pages with their pictures", async ({
  page,
}) => {
  await open(page, {
    scrollMode: "paged",
    pageLayout: "spread",
    defaultZoom: "fitPage",
  });
  const start = await shownNow(page);
  for (const key of [
    "PageDown",
    "PageDown",
    "PageDown",
    "PageDown",
    "PageUp",
    "PageUp",
    "PageDown",
    "PageDown",
  ]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
  }
  // Four more turns forward than back: from the spread of pages 0 and 1 to the one of 8 and 9.
  expect(start).toBe("0,1");
  await expect.poll(() => shownNow(page)).toBe("8,9");
  await expect.poll(() => painted(page)).toBe(true);
  await expect.poll(() => softPages(page)).toBe(0);
  const settled = await sample(page, 500);
  expect(settled.filter((frame) => frame.blank > 0).length).toBe(0);
});

test("a jump to a page far away paints within a bound", async ({ page }) => {
  await open(page, {
    scrollMode: "paged",
    pageLayout: "single",
    defaultZoom: "fitPage",
  });
  const frames = sample(page, 2_000);
  await act(page, { action: "goToPage", page: 11 });
  const seen = await frames;
  const jumped = seen.findIndex((frame) => frame.shown === "10");
  expect(jumped).toBeGreaterThan(-1);
  const first = firstPainted(seen, jumped)!;
  expect(first, "a picture appeared").toBeTruthy();
  expect(first.at - seen[jumped]!.at).toBeLessThan(800);
  expect(await painted(page)).toBe(true);
});

test("zoomed to 300%, turns that keep the place paint the new pages and rest sharp", async ({
  page,
}) => {
  await open(page, {
    scrollMode: "paged",
    pageLayout: "spread",
    defaultZoom: 300,
  });
  const before = await shownNow(page);
  const frames = sample(page, 2_500);
  // Zoomed past a spread, a turn goes page by page: the second one reaches the next spread.
  await act(page, { action: "nextPageKeepingPlace" });
  await act(page, { action: "nextPageKeepingPlace" });
  const seen = await frames;
  const turned = seen.findIndex((frame) => frame.shown !== before);
  expect(turned).toBeGreaterThan(-1);
  const first = firstPainted(seen, turned)!;
  expect(first, "a picture appeared").toBeTruthy();
  expect(first.at - seen[turned]!.at).toBeLessThan(800);
  await expect.poll(() => softPages(page)).toBe(0);
});

test("a zoom step never shows a page without its picture, and the pictures come out sharp at the new zoom", async ({
  page,
}) => {
  await open(page, {
    scrollMode: "continuous",
    pageLayout: "single",
    defaultZoom: "fitWidth",
  });
  for (const action of ["zoomIn", "zoomIn", "zoomOut"] as const) {
    const had = new Set((await shownNow(page)).split(","));
    const frames = sample(page, 1_200);
    await act(page, { action });
    const seen = await frames;
    // A page that comes into view as the pages shrink may wait for its picture; one that had it keeps it.
    expect(
      seen.filter((frame) => frame.blankPages.some((index) => had.has(index)))
        .length,
      action,
    ).toBe(0);
    await expect.poll(() => softPages(page), { timeout: 5_000 }).toBe(0);
    expect(await painted(page)).toBe(true);
  }
});

test("a picture taken back while it decodes is dropped, not shown as a broken image over the page's picture", async ({
  page,
}) => {
  // EmbedPDF revokes a picture's URL when it starts the next one, a pinch step
  // later, and that picture arrives later still. A slow machine's decode of the
  // picture ends in between, and giving the revoked URL to the page loads a
  // broken image over its picture. This decode always ends there: the moment
  // its URL is revoked, whatever the machine's speed (or after a second, for
  // the last picture, which nothing revokes).
  await page.addInitScript(() => {
    const counter = window as unknown as { brokenPictures: number };
    counter.brokenPictures = 0;
    document.addEventListener(
      "error",
      (event) => {
        if (
          event.target instanceof HTMLImageElement &&
          event.target.closest(".page")
        ) {
          counter.brokenPictures++;
        }
      },
      true,
    );
    const endsOnRevoke = new Map<string, () => void>();
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const url = this.src;
      return decode.call(this).then(
        (result) =>
          new Promise((resolve) => {
            endsOnRevoke.set(url, () => resolve(result));
            setTimeout(() => resolve(result), 1_000);
          }),
      );
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      revoke(url);
      endsOnRevoke.get(url)?.();
      endsOnRevoke.delete(url);
    };
  });
  await open(page, {
    scrollMode: "continuous",
    pageLayout: "single",
    defaultZoom: "actual",
  });
  const had = new Set((await shownNow(page)).split(","));
  const frames = sample(page, 2_500);
  await page.evaluate(async () => {
    const viewport = document.querySelector(".viewport")!;
    const view = viewport.getBoundingClientRect();
    for (let i = 0; i < 30; i++) {
      viewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -2.5,
          deltaMode: 0,
          ctrlKey: true,
          clientX: view.left + view.width / 2,
          clientY: view.top + view.height / 3,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise(requestAnimationFrame);
    }
  });
  const seen = await frames;
  expect(
    await page.evaluate(
      () => (window as unknown as { brokenPictures: number }).brokenPictures,
    ),
    "pictures that loaded as broken images",
  ).toBe(0);
  expect(
    seen.filter((frame) => frame.blankPages.some((index) => had.has(index)))
      .length,
  ).toBe(0);
  // The pictures the pinch dropped were stale: the last one is shown and sharp.
  await expect.poll(() => softPages(page), { timeout: 5_000 }).toBe(0);
  expect(await painted(page)).toBe(true);
});

test("continuous scrolling: the pages that come into view have a picture within a bound and rest sharp", async ({
  page,
}) => {
  await open(page, {
    scrollMode: "continuous",
    pageLayout: "single",
    defaultZoom: "fitWidth",
  });
  await page.mouse.move(550, 350);
  const frames = sample(page, 2_000);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(60);
  }
  const seen = await frames;
  // A page scrolled to may wait for its picture a few frames (60 frames is one second), never long.
  const blankMs = seen.filter((frame) => frame.blank > 0).length * (1000 / 60);
  expect(blankMs).toBeLessThan(500);
  await expect.poll(() => painted(page)).toBe(true);
  await expect.poll(() => softPages(page)).toBe(0);
});

test("memory stays bounded: only the pages of the view are mounted, however far the reader has gone", async ({
  page,
}) => {
  await open(page, {
    scrollMode: "paged",
    pageLayout: "single",
    defaultZoom: "fitPage",
  });
  for (let i = 0; i < 11; i++) {
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(150);
  }
  await expect.poll(() => shownNow(page)).toBe("11");
  await expect.poll(() => page.locator(".page > img").count()).toBe(1);
});

test.describe("on a 2x screen", () => {
  test.use({ deviceScaleFactor: 2 });

  test("pages rest sharp at fit width and after a zoom step: the tiles bring the pixels the whole-page picture lacks", async ({
    page,
  }) => {
    await open(page, {
      scrollMode: "continuous",
      pageLayout: "single",
      defaultZoom: "fitWidth",
    });
    await act(page, { action: "zoomIn" });
    await expect.poll(() => softPages(page), { timeout: 5_000 }).toBe(0);
    expect(await painted(page)).toBe(true);
  });
});
