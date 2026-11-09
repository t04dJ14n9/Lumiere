import type { Frame } from "@playwright/test";
import { command, expect, openFile, pdfViewer, test } from "./workbench";

// Turning pages in the real editor: EmbedPDF draws the picture of a page when
// it comes into view, so a turn may show a page without its picture for a few
// frames, never for long, and every page shown ends with one.

const PDF = "docs/outline.pdf";

interface Sample {
  at: number;
  shown: string;
  /** Pages in view without a loaded picture. */
  blank: number;
}

/**
 * Sample every frame in the viewer for `ms`: the pages shown, and how many of
 * those in view have no picture. Only pages in view can be seen blank: a page
 * mounted just outside it is for the next scroll.
 */
function sample(viewer: Frame, ms: number): Promise<Sample[]> {
  return viewer.evaluate(
    (ms) =>
      new Promise<Sample[]>((resolve) => {
        const frames: Sample[] = [];
        const start = performance.now();
        const tick = (): void => {
          const pages = Array.from(
            document.querySelectorAll<HTMLElement>(".page[data-page-index]"),
          );
          const view = document
            .querySelector(".viewport")!
            .getBoundingClientRect();
          const blank = pages
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.bottom > view.top && box.top < view.bottom;
            })
            .filter((element) => {
              // A new picture loads beside the old one, which stays (and
              // keeps its width) until the new one is decoded: blank is no
              // picture at all.
              const image =
                element.querySelector<HTMLImageElement>(":scope > img");
              return !image || image.naturalWidth === 0;
            }).length;
          frames.push({
            at: performance.now() - start,
            shown: pages.map((p) => p.dataset.pageIndex).join(","),
            blank,
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

/** How many pages in view have no picture right now. */
async function blankNow(viewer: Frame): Promise<number> {
  const [frame] = await sample(viewer, 0);
  return frame!.blank;
}

/** The longest time in a row that a page in view was without its picture, in ms. */
function longestBlank(frames: Sample[]): number {
  let longest = 0;
  let since: number | undefined;
  for (const frame of frames) {
    if (frame.blank === 0) {
      since = undefined;
    } else {
      since ??= frame.at;
      longest = Math.max(longest, frame.at - since);
    }
  }
  return longest;
}

test("turning pages in two-page page-by-page mode shows each page's picture soon, even turned quickly, and keeps it", async ({
  workbench: page,
}) => {
  await openFile(page, PDF);
  const viewer = await pdfViewer(page);
  await expect(viewer.locator(".page img").first()).toBeVisible();
  await command(page, "PDF: Two Pages (1–2, 3–4)");
  await command(page, "PDF: Page-by-page Scrolling");
  await command(page, "PDF: Fit Page");
  try {
    await expect.poll(() => blankNow(viewer)).toBe(0);
    await page.waitForTimeout(1500);
    await expect
      .poll(() => viewer.evaluate(() => document.hasFocus()))
      .toBe(true);
    const frames = sample(viewer, 3_000);
    for (const key of [
      "PageDown",
      "PageDown",
      "PageDown",
      "PageUp",
      "PageDown",
    ]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
    }
    const seen = await frames;
    expect(
      new Set(seen.map((frame) => frame.shown)).size,
      "pages turned",
    ).toBeGreaterThan(2);
    // A page reached before its picture is drawn waits for it, never long.
    expect(longestBlank(seen)).toBeLessThan(400);
    await expect.poll(() => blankNow(viewer)).toBe(0);
    // Page-by-page mounts only the pages read: the two of the spread.
    await expect.poll(() => viewer.locator(".page").count()).toBe(2);
  } finally {
    await command(page, "PDF: Continuous Scrolling");
    await command(page, "PDF: Single Page");
  }
});
