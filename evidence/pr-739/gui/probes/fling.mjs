import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true });
const page = await context.newPage();
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.waitForTimeout(300);
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const box = await page.locator('.page[data-page-index="0"]').boundingBox();
const scale = box.width / 300;
const x = box.x + 250 * scale, y = box.y + 250 * scale;
const touch = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
const state = () => page.evaluate(() => ({
  indexes: [...document.querySelectorAll(".page")].map((n) => Number(n.dataset.pageIndex)),
  view: window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage,
  scrollTop: window.__stage.getScrollMetrics().scrollTop,
}));
for (const [label, deltas, pause] of [
  ["fast-fling-up", [25, 45, 65, 85, 105, 125], 0],
  ["slow-drag-up", [10, 12, 12, 12, 12, 12, 12, 12], 30],
]) {
  console.log(label, "before", JSON.stringify(await state()));
  await touch("touchStart", [{ x, y, id: 1 }]);
  let cy = y;
  for (const d of deltas) {
    cy -= d;
    await touch("touchMove", [{ x, y: cy, id: 1 }]);
    if (pause) await page.waitForTimeout(pause);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(700);
  console.log(label, "after", JSON.stringify(await state()));
  // reset to page 1 for next case
  await page.evaluate(() => window.hostSend({ type: "action", action: { action: "goToPage", page: 1 } }));
  await page.waitForTimeout(500);
}
await browser.close();
