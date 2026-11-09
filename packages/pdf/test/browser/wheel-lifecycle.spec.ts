import { expect, test, type Page } from "@playwright/test";
import { scrollMetrics, scrollTo } from "./stage-support";
import { lastView, openView } from "./view-controls-support";

/** Dispatch wheel events at the viewport's centre (or `clientX`, `clientY`); resolves to each event's `defaultPrevented`. */
function wheel(
  page: Page,
  events: {
    deltaX?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    deltaMode?: number;
    clientX?: number;
    clientY?: number;
  }[],
): Promise<boolean[]> {
  return page.evaluate((events) => {
    const viewport = document.querySelector(".viewport")!;
    const box = viewport.getBoundingClientRect();
    return events.map((init) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        ...init,
      });
      (
        document.elementFromPoint(event.clientX, event.clientY) ?? viewport
      ).dispatchEvent(event);
      return event.defaultPrevented;
    });
  }, events);
}

const zoom = async (page: Page) => (await lastView(page))!.zoomPercent;
const scrollOffsets = async (page: Page) => {
  const { scrollLeft, scrollTop } = await scrollMetrics(page);
  return { left: scrollLeft, top: scrollTop };
};

/** What one pinch event multiplies the zoom by: the same curve a trackpad's fingers follow. */
const pinchFactor = (deltaY: number) => Math.exp(-deltaY / 100);

test("Ctrl/Cmd+wheel and pinch never zoom the browser's window, and plain wheel input pans the view itself", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await openView(page, { defaultZoom: 300 });
  await page.waitForTimeout(400);
  // The Stage has no scrolling element, so it takes every wheel event and pans its camera with it.
  const before = await scrollOffsets(page);
  expect(
    await wheel(page, [
      { deltaY: 3 },
      { deltaY: 7 },
      { deltaX: 5 },
      { deltaX: 4, deltaY: 1 },
    ]),
  ).toEqual([true, true, true, true]);
  await expect
    .poll(async () => {
      const now = await scrollOffsets(page);
      return [now.top - before.top, now.left - before.left];
    })
    .toEqual([11, 9]);
  // Pinch and Ctrl/Cmd+wheel: the page must not zoom the whole window.
  expect(
    await wheel(page, [
      { deltaY: -2, ctrlKey: true },
      { deltaY: 1, metaKey: true },
      { deltaX: 3, ctrlKey: true },
    ]),
  ).toEqual([true, true, true]);
});

test("a pinch is laid out as it goes: the zoom follows the deltas, one after another, and the page box is its layout box", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await openView(page, { defaultZoom: 200 });
  await page.waitForTimeout(500);
  const before = await zoom(page);
  const deltas = [-4, -5, -6, -5];
  for (const deltaY of deltas) {
    await wheel(page, [{ deltaY, ctrlKey: true }]);
  }
  const expected =
    before * deltas.reduce((scale, deltaY) => scale * pinchFactor(deltaY), 1);
  await expect
    .poll(async () => Math.abs((await zoom(page)) / expected - 1))
    .toBeLessThan(0.02);
  // Nothing is scaled by a transform on top of the layout: the page's box is its layout box.
  const { shown, laid } = await page.evaluate(() => {
    const page0 = document.querySelector<HTMLElement>(".page")!;
    return {
      shown: page0.getBoundingClientRect().width,
      laid: page0.offsetWidth,
    };
  });
  expect(Math.abs(shown - laid)).toBeLessThan(1.5);
});

test("a pinch that starts after a pause carries on from the zoom on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await openView(page, { defaultZoom: 150 });
  await page.waitForTimeout(500);
  const before = await zoom(page);
  const first = [-6, -6, -6];
  const second = [-5, -5];
  for (const deltaY of first) {
    await wheel(page, [{ deltaY, ctrlKey: true }]);
  }
  await page.waitForTimeout(190);
  for (const deltaY of second) {
    await wheel(page, [{ deltaY, ctrlKey: true }]);
  }
  const scale = [...first, ...second].reduce(
    (product, deltaY) => product * pinchFactor(deltaY),
    1,
  );
  await expect
    .poll(async () => Math.abs((await zoom(page)) / (before * scale) - 1), {
      timeout: 5_000,
    })
    .toBeLessThan(0.03);
});

test("a pinch is on screen in the frame after its events, with no wait for it to end", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await openView(page, { defaultZoom: 200 });
  await page.waitForTimeout(500);
  const before = await zoom(page);
  // In one task, so the timing is the page's: pinch, then see how long the layout takes to grow.
  const grewAfterMs = await page.evaluate(async () => {
    const viewport = document.querySelector(".viewport")!;
    const box = viewport.getBoundingClientRect();
    const wide = document.querySelector<HTMLElement>(".page")!.offsetWidth;
    for (const deltaY of [-8, -8]) {
      document.elementFromPoint(box.left + 100, box.top + 100)!.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: box.left + 100,
          clientY: box.top + 100,
        }),
      );
    }
    const start = performance.now();
    while (performance.now() - start < 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (
        document.querySelector<HTMLElement>(".page")!.offsetWidth >
        wide * 1.1
      ) {
        return performance.now() - start;
      }
    }
    return Infinity;
  });
  // Well before the 140 ms pause that settled a pinch in the viewer EmbedPDF 2 drove.
  expect(grewAfterMs).toBeLessThan(110);
  await expect.poll(async () => (await zoom(page)) > before * 1.1).toBe(true);
});

test("a Ctrl+wheel notch only zooms, by EmbedPDF's step around the pointer, even with smooth scrolling on", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await openView(page, { defaultZoom: 100, smoothScrolling: true });
  await page.waitForTimeout(400);
  await scrollTo(page, { top: 3_000 });
  const before = await zoom(page);
  const scrolled = (await scrollOffsets(page)).top;
  // At the viewport's own top edge the page point there stays where it is, so
  // the offset only grows with the zoom (it counts the 12 px of padding
  // above the first page): any scroll on top of it would be the smooth wheel.
  const box = (await page.locator(".viewport").boundingBox())!;
  await wheel(page, [
    { deltaY: -100, ctrlKey: true, clientX: box.x + 100, clientY: box.y },
  ]);
  await expect.poll(() => zoom(page)).toBe(Math.round(before * 1.2));
  await page.waitForTimeout(500);
  const PADDING = 12;
  const expected = (scrolled - PADDING) * 1.2 + PADDING;
  expect(Math.abs((await scrollOffsets(page)).top - expected)).toBeLessThan(2);
});
