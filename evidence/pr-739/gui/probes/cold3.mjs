import { chromium } from "@playwright/test";
const FIND_CAPS = () => {
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
const INSTRUMENT = () => {
  window.__events = []; window.__listeners = [];
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    return original.call(this, type, listener, options);
  };
  const rec = (event) => window.__events.push({ type: event.type, pointerType: event.pointerType ?? null });
  document.addEventListener("pointerdown", rec, true);
  window.addEventListener("pointerdown", rec);
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await context.newPage();
await page.addInitScript(INSTRUMENT);
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
console.log("caps", await page.evaluate(FIND_CAPS));
const statuses = () => page.evaluate(() => {
  const { selection } = window.__caps;
  return Array.from({ length: 6 }, (_, i) => ({ on: 5 + 2 * i, loaded: selection.isLoaded({ kind: "objectNumber", objectNumber: 5 + 2 * i }) }));
});
console.log("A after open", JSON.stringify(await statuses()));
const pageOneRef = await page.evaluate(() => {
  const stage = window.__stage;
  const rect = document.querySelector(".viewport").getBoundingClientRect();
  const box = document.querySelector(".page").getBoundingClientRect();
  return stage.getPageAt({ x: box.left + 60 - rect.left, y: box.top + 200 - rect.top })?.ref;
});
console.log("pageOneRef", JSON.stringify(pageOneRef), "statuses", JSON.stringify(await statuses()));
const box = await page.locator(".page").first().boundingBox();
const scale = box.width / 300;
const blank = { x: box.x + 20 * scale, y: box.y + 250 * scale };
console.log("blank", JSON.stringify(blank), "statuses", JSON.stringify(await statuses()));
await page.evaluate(() => window.hostSend({ type: "action", action: { action: "goToPage", page: 2 } }));
await page.locator('.page[data-page-index="1"]').waitFor({ state: "visible", timeout: 15000 });
console.log("B after goto", JSON.stringify(await statuses()));
const box2 = await page.locator(".page").first().boundingBox();
console.log("C after box2", JSON.stringify(await statuses()));
const cold = await page.evaluate(({ x, y }) => {
  const { selection } = window.__caps;
  const stage = window.__stage;
  const rect = document.querySelector(".viewport").getBoundingClientRect();
  const viewport = { x: x - rect.left, y: y - rect.top };
  const at = stage.getPageAt(viewport);
  return { ref: at?.ref, isLoaded: at ? selection.isLoaded(at.ref) : null, isOverText: at ? selection.isOverText(at.ref, stage.viewportToPage(at.ref, viewport)) : null };
}, blank);
console.log("D cold", JSON.stringify(cold), "statuses", JSON.stringify(await statuses()));
await browser.close();
