import { chromium } from "@playwright/test";
const FIND = () => {
  const root = document.getElementById("root");
  const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  const seen = new Set(); const stack = [root[key]];
  let selection = null, ref = null, interaction = null;
  while (stack.length) {
    const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f);
    let h = f.memoizedState, g = 0;
    while (h && g++ < 200) {
      const v = h.memoizedState;
      if (v && typeof v === "object") {
        if (typeof v.isLoaded === "function" && typeof v.isOverText === "function" && !selection) selection = v;
        if (typeof v.getActiveTool === "function" && typeof v.wouldClaimTouch === "function" && !interaction) interaction = v;
        if (v.current && typeof v.current === "object" && "selection" in v.current && "input" in v.current && !ref) ref = v.current;
      }
      h = h.next;
    }
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
  }
  window.__caps = { selection, interaction };
  window.__latest = ref;
  window.__steps = [];
  if (ref) {
    const original = ref.input.step;
    ref.input.step = (...args) => { window.__steps.push({ delta: args[0], extra: args.slice(1) }); return original(...args); };
  }
  return { selection: Boolean(selection), ref: Boolean(ref), same: ref?.selection === selection };
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
console.log("FIND", JSON.stringify(await page.evaluate(FIND)));
const box = await page.locator(".page").first().boundingBox();
const scale = box.width / 300;
const blank = { x: box.x + 250 * scale, y: box.y + 250 * scale };
const text = { x: box.x + 90 * scale, y: box.y + 94 * scale };
for (let i = 0; i < 40; i++) {
  await page.mouse.move(text.x + (i % 2), text.y);
  if ((await page.evaluate(([x,y]) => getComputedStyle(document.elementFromPoint(x,y)).cursor, [text.x, text.y])) === "text") break;
  await page.waitForTimeout(50);
}
const drag = async () => { await page.mouse.move(blank.x, blank.y); await page.mouse.down(); await page.mouse.move(blank.x, blank.y - 120, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(500); };
const state = () => page.evaluate(() => ({ readingPage: window.__messages.filter(m=>m.patch?.view).at(-1).patch.view.readingPage, steps: window.__steps.splice(0) }));
console.log("warm before", JSON.stringify(await state()));
await drag();
console.log("warm after", JSON.stringify(await state()));
await page.evaluate(() => { window.__originalIsLoaded = window.__caps.selection.isLoaded; window.__caps.selection.isLoaded = () => false; });
await drag();
console.log("stubbed cold after", JSON.stringify(await state()));
await page.evaluate(() => { window.__caps.selection.isLoaded = window.__originalIsLoaded; });
await drag();
console.log("restored after", JSON.stringify(await state()));
await browser.close();
