import { chromium } from "@playwright/test";
const CAPS = () => {
  const root = document.getElementById("root");
  const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  const seen = new Set(); const stack = [root[key]];
  let interaction = null, selection = null;
  const inspect = (v) => {
    if (!v || typeof v !== "object") return;
    if (!interaction && typeof v.getActiveTool === "function" && typeof v.wouldClaimTouch === "function") interaction = v;
    if (!selection && typeof v.isLoaded === "function" && typeof v.isOverText === "function") selection = v;
  };
  while (stack.length && (!interaction || !selection)) {
    const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f);
    let h = f.memoizedState, g = 0;
    while (h && g++ < 200) { inspect(h.memoizedState); inspect(h.memoizedState?.value); inspect(h.memoizedState?.current); h = h.next; }
    inspect(f.memoizedProps); inspect(f.memoizedProps?.value); inspect(f.memoizedProps?.value?.current);
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
  }
  window.__caps = { interaction, selection };
  return Boolean(interaction && selection);
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
await context.addInitScript(() => {
  window.__events = [];
  document.addEventListener("pointerdown", (e) => window.__events.push({ type: "pointerdown", pointerType: e.pointerType }), true);
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
console.log("caps", await page.evaluate(CAPS));
const status = (index) => page.evaluate((i) => {
  const { selection } = window.__caps;
  return { objectNumber: 5 + 2 * (i - 1), loaded: selection.isLoaded({ kind: "objectNumber", objectNumber: 5 + 2 * (i - 1) }) };
}, index);
console.log("page1 before", await status(1), "page2 before", await status(2));
await page.evaluate(() => window.hostSend({ type: "action", action: { action: "goToPage", page: 2 } }));
await page.locator('.page[data-page-index="1"]').waitFor({ state: "visible", timeout: 10000 });
console.log("page2 after goto (immediate)", await status(2));
const box = await page.locator('.page[data-page-index="1"]').boundingBox();
const scale = box.width / 300;
const x = box.x + 250 * scale, y = box.y + 250 * scale;
const cdp = await context.newCDPSession(page);
const common = { button: "left", buttons: 1, clickCount: 1 };
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, ...common });
for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: y - 10 * i, ...common });
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y: y - 120, ...common, buttons: 0 });
await page.waitForTimeout(500);
console.log("COLD DRAG", JSON.stringify({
  indexes: await page.locator(".page").evaluateAll((ns) => ns.map((n) => Number(n.dataset.pageIndex))),
  view: await page.evaluate(() => window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage),
  page2After: await status(2),
  downEvents: await page.evaluate(() => window.__events),
}));
// Warm geometry by hovering, then drag again.
await page.mouse.move(box.x + 250 * scale, box.y + 200 * scale);
await page.waitForTimeout(600);
console.log("page2 after hover", await status(2));
await page.mouse.move(x, y);
await page.mouse.down();
await page.mouse.move(x, y - 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
console.log("WARM DRAG", JSON.stringify({
  indexes: await page.locator(".page").evaluateAll((ns) => ns.map((n) => Number(n.dataset.pageIndex))),
  view: await page.evaluate(() => window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage),
}));
await browser.close();
