import { expect, test, type Page } from "@playwright/test";
import { scrollBy } from "./stage-support";
import { open, pageOffset } from "./viewer-support";

test("reloads keep the one engine, and closing the page stops it and its workers", async ({
  page,
}) => {
  await open(page);
  // The PDFium worker and its image encoders, which the first renders start.
  const workers = await settledWorkerCount(page);
  expect(workers).toBeGreaterThan(0);
  for (let reload = 1; reload <= 3; reload++) {
    await page.evaluate(async (reload) => {
      document
        .querySelector(".viewer")!
        .classList.add(`before-reload-${reload}`);
      const data = await (await fetch("/fixtures/outline.pdf")).arrayBuffer();
      (window as unknown as { hostSend: (message: unknown) => void }).hostSend({
        type: "load",
        sha256: "test-sha",
        data,
      });
    }, reload);
    await expect(
      page.locator(
        `.viewer:not(.before-reload-${reload}) .page[data-page-index="0"] img`,
      ),
    ).toBeVisible();
  }
  // The engine of the page (engine-host.ts) opened each new document: no
  // worker was added, and none was left behind.
  expect(await settledWorkerCount(page)).toBe(workers);
  // The page going away stops the engine, ending its workers.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => page.workers().length).toBe(0);
});

/** The number of workers once it has stopped changing. */
async function settledWorkerCount(page: Page): Promise<number> {
  let last = -1;
  let steady = 0;
  await expect
    .poll(
      () => {
        const count = page.workers().length;
        steady = count === last ? steady + 1 : 0;
        last = count;
        return steady;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(5);
  return last;
}

test("a reloaded file reopens at the same place and zoom", async ({ page }) => {
  await open(page);
  const field = page.getByRole("textbox", { name: "Page" });
  const zoom = page.getByRole("textbox", { name: "Zoom" });
  await zoom.fill("300");
  await zoom.press("Enter");
  await expect(zoom).toHaveValue("300");
  await field.fill("7");
  await field.press("Enter");
  await expect
    .poll(async () => Math.abs((await pageOffset(page, 7))!))
    .toBeLessThan(16);
  // Partway down page 7.
  await scrollBy(page, { top: 200 });
  await expect(field).toHaveValue("7");
  // The viewer remembers the place from its scroll events; let them arrive
  // before the reload.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const before = (await pageOffset(page, 7))!;

  await page.evaluate(async () => {
    document.querySelector(".viewer")!.classList.add("before-reload");
    const data = await (await fetch("/fixtures/outline.pdf")).arrayBuffer();
    (window as unknown as { hostSend: (message: unknown) => void }).hostSend({
      type: "load",
      sha256: "test-sha",
      data,
    });
  });
  await expect(
    page.locator('.viewer:not(.before-reload) .page[data-page-index="6"] img'),
  ).toBeVisible();
  await expect(zoom).toHaveValue("300");
  await expect(field).toHaveValue("7");
  await expect
    .poll(async () => Math.abs((await pageOffset(page, 7))! - before))
    .toBeLessThan(2);
});

test("zoom buttons and the zoom field change the zoom", async ({ page }) => {
  await open(page);
  const zoom = page.getByRole("textbox", { name: "Zoom" });
  const initial = Number(await zoom.inputValue());
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(async () => Number(await zoom.inputValue()))
    .toBeGreaterThan(initial);
  await zoom.fill("50");
  await zoom.press("Enter");
  await expect(zoom).toHaveValue("50");
  const width = (await page
    .locator('.page[data-page-index="0"]')
    .boundingBox())!.width;
  expect(Math.round(width)).toBe(150);
});

test("each Ctrl+wheel notch zooms one step, and small trackpad movements zoom in proportion", async ({
  page,
}) => {
  await open(page);
  const zoom = page.getByRole("textbox", { name: "Zoom" });
  await zoom.fill("100");
  await zoom.press("Enter");
  await expect(zoom).toHaveValue("100");
  const box = (await page.locator(".viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // The viewer leaves Ctrl+wheel to EmbedPDF's zoom, which steps a mouse notch
  // by a factor of 1.2 around the pointer (not by the zoom buttons' ladder).
  let level = 100;
  const notch = async (deltaY: number): Promise<void> => {
    level *= deltaY < 0 ? 1.2 : 1 / 1.2;
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, deltaY);
    await page.keyboard.up("Control");
    await expect(zoom).toHaveValue(String(Math.round(level)));
  };
  await notch(-100);
  await notch(-100);
  await notch(100);
  await notch(100);
  await notch(100);

  // Small deltas are a pinch: the zoom follows exp(total / 100), here e^0.4 x the level.
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -10);
  }
  await page.keyboard.up("Control");
  const pinched = level * Math.exp(0.4);
  await expect
    .poll(async () => Number(await zoom.inputValue()), { timeout: 10_000 })
    .toBeGreaterThan(pinched - 2);
  expect(Number(await zoom.inputValue())).toBeLessThan(pinched + 2);
});
