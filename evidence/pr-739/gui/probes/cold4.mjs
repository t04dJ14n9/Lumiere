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
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await context.newPage();
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage", pageLayout: "spread" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
console.log("caps", await page.evaluate(FIND_CAPS));
await page.waitForTimeout(500);
console.log("indexes", await page.locator(".page").evaluateAll((ns) => ns.map((n) => Number(n.dataset.pageIndex))));
const status = () => page.evaluate(() => {
  const { selection } = window.__caps;
  return Array.from({length: 6}, (_, i) => ({on: 5 + 2*i, loaded: selection.isLoaded({kind: "objectNumber", objectNumber: 5 + 2*i})}));
});
console.log("status", JSON.stringify(await status()));
const box2 = await page.locator('.page[data-page-index="1"]').boundingBox().catch(() => null);
console.log("page2 box", JSON.stringify(box2));
const box = box2 ?? await page.locator('.page[data-page-index="0"]').boundingBox();
const scale = box.width / 300;
const blank = { x: box.x + 20 * scale, y: box.y + 250 * scale };
console.log("blank", JSON.stringify(blank));
const info = await page.evaluate(({x,y}) => {
  const { selection } = window.__caps;
  const stage = window.__stage;
  const rect = document.querySelector(".viewport").getBoundingClientRect();
  const v = {x: x - rect.left, y: y - rect.top};
  const at = stage.getPageAt(v);
  return {ref: at?.ref, loaded: at ? selection.isLoaded(at.ref) : null, over: at ? selection.isOverText(at.ref, stage.viewportToPage(at.ref, v)) : null, element: document.elementFromPoint(x,y)?.className, path: window.document.elementsFromPoint(x,y).slice(0,4).map(n => String(n.className ?? n.nodeName).slice(0,30))};
}, blank);
console.log("blank info", JSON.stringify(info));
await browser.close();
