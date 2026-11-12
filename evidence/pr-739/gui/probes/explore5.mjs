// Diagnostic 3: DOM pointerdown path for a Playwright mouse press.
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:19239";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
await context.addInitScript(() => {
  window.__dom = [];
  window.__listeners = [];
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === "pointerdown" || type === "pointerup") {
      window.__listeners.push({
        type,
        target:
          this === window ? "window" : this === document ? "document" : (this.className?.toString?.() ?? this.nodeName),
        options: typeof options === "object" ? JSON.stringify(options) : String(options),
      });
    }
    return original.call(this, type, listener, options);
  };
  document.addEventListener(
    "pointerdown",
    (event) => {
      window.__dom.push({
        phase: "capture-pointerdown",
        pointerType: event.pointerType,
        button: event.button,
        buttons: event.buttons,
        pointerId: event.pointerId,
        target: event.target?.className?.toString?.() ?? event.target?.nodeName,
        path: event.composedPath().slice(0, 8).map((node) => node.className?.toString?.() ?? node.nodeName),
        prevented: event.defaultPrevented,
      });
    },
    true,
  );
  window.addEventListener("pointerdown", (event) => {
    window.__dom.push({
      phase: "bubble-pointerdown",
      pointerType: event.pointerType,
      prevented: event.defaultPrevented,
      propagationStopped: event.cancelBubble,
    });
  });
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR", String(error)));
const view = encodeURIComponent(
  JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }),
);
await page.goto(`${BASE}/?toolbar=slim&view=${view}`);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.waitForTimeout(300);

const box = await page.locator('.page[data-page-index="0"]').boundingBox();
const scale = box.width / 300;
const blank = { x: box.x + 150 * scale, y: box.y + 300 * scale };
await page.mouse.move(box.x + 90 * scale, box.y + 94 * scale);
for (let i = 0; i < 30; i++) {
  if ((await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [box.x + 90 * scale, box.y + 94 * scale])) === "text") break;
  await page.waitForTimeout(50);
}
await page.mouse.move(blank.x, blank.y);
await page.mouse.down();
await page.mouse.move(blank.x, blank.y - 120, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(400);
console.log(JSON.stringify(await page.evaluate(() => ({
  dom: window.__dom,
  listeners: window.__listeners,
  indexes: [...document.querySelectorAll(".page")].map((n) => Number(n.dataset.pageIndex)),
  view: window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage,
})), null, 2));
await browser.close();
