import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
const box = await page.locator(".page").first().boundingBox();
const scale = box.width / 300;
const blank = { x: box.x + 250 * scale, y: box.y + 250 * scale };
const text = { x: box.x + 90 * scale, y: box.y + 94 * scale };
for (let i = 0; i < 40; i++) {
  await page.mouse.move(text.x + (i % 2), text.y);
  if ((await page.evaluate(([x,y]) => getComputedStyle(document.elementFromPoint(x,y)).cursor, [text.x, text.y])) === "text") break;
  await page.waitForTimeout(50);
}
console.log("before", await page.evaluate(() => window.__messages.filter(m=>m.patch?.view).at(-1).patch.view.readingPage));
await page.evaluate(({x,y}) => {
  const viewport = document.querySelector(".viewport");
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, view: window };
  viewport.dispatchEvent(new PointerEvent("pointerdown", opts));
  window.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientY: y - 60 }));
  window.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientY: y - 120 }));
  window.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, clientY: y - 120 }));
}, blank);
await page.waitForTimeout(600);
console.log("after", await page.evaluate(() => ({
  readingPage: window.__messages.filter(m=>m.patch?.view).at(-1).patch.view.readingPage,
  indexes: [...document.querySelectorAll(".page")].map(n=>Number(n.dataset.pageIndex)),
})));
await browser.close();
