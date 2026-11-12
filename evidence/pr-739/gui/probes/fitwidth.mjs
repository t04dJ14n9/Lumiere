import { chromium } from "@playwright/test";
const FIND = () => {
  const root = document.getElementById("root");
  const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  const seen = new Set(); const stack = [root[key]];
  let selection = null, ref = null;
  while (stack.length) {
    const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f);
    let h = f.memoizedState, g = 0;
    while (h && g++ < 200) {
      const v = h.memoizedState;
      if (v && typeof v === "object") {
        if (typeof v.isLoaded === "function" && typeof v.isOverText === "function" && !selection) selection = v;
        if (v.current && typeof v.current === "object" && "selection" in v.current && "input" in v.current && !ref) ref = v.current;
      }
      h = h.next;
    }
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
  }
  window.__caps = { selection }; window.__latest = ref; window.__steps = [];
  if (ref) { const orig = ref.input.step; ref.input.step = (...a) => { window.__steps.push(a[0]); return orig(...a); }; }
  return Boolean(selection && ref);
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitWidth" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
console.log("FIND", await page.evaluate(FIND));
const box = await page.locator(".page").first().boundingBox();
const scale = box.width / 300;
// on-screen blank: x=250 (clear of link x<=228), y=100 (clear of text x<=206)
const blank = { x: box.x + 250 * scale, y: box.y + 100 * scale };
const text = { x: box.x + 90 * scale, y: box.y + 94 * scale };
console.log("blank", JSON.stringify(blank), "box", JSON.stringify(box));
for (let i = 0; i < 40; i++) {
  await page.mouse.move(text.x + (i % 2), text.y);
  if ((await page.evaluate(([x,y]) => getComputedStyle(document.elementFromPoint(x,y)).cursor, [text.x, text.y])) === "text") break;
  await page.waitForTimeout(50);
}
const state = () => page.evaluate(() => ({
  readingPage: window.__messages.filter(m=>m.patch?.view).at(-1).patch.view.readingPage,
  scrollTop: window.__stage.getScrollMetrics().scrollTop,
  steps: window.__steps.splice(0),
}));
const drag = async () => { await page.mouse.move(blank.x, blank.y); await page.mouse.down(); await page.mouse.move(blank.x, blank.y - 120, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(500); };
console.log("warm before", JSON.stringify(await state()));
await drag();
console.log("warm after", JSON.stringify(await state()));
await page.evaluate(() => { window.__orig = window.__caps.selection.isLoaded; window.__caps.selection.isLoaded = () => false; });
console.log("cold before", JSON.stringify(await state()));
await drag();
console.log("cold after", JSON.stringify(await state()));
await page.evaluate(() => { window.__caps.selection.isLoaded = window.__orig; });
await drag();
console.log("restored after", JSON.stringify(await state()));
await browser.close();
