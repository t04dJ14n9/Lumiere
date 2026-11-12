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
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.waitForTimeout(400);
await page.evaluate(CAPS);
console.log(JSON.stringify(await page.evaluate(() => {
  const { selection } = window.__caps;
  const ref = { kind: "objectNumber", objectNumber: 5 };
  const xs = [5, 20, 35, 250, 270, 285, 295, 299];
  const ys = [10, 20, 30, 100, 150, 200, 250, 300, 350, 380, 395];
  const rows = xs.map((x) => ({ x, over: ys.map((y) => selection.isOverText(ref, { x, y }) ? 1 : 0).join("") }));
  return { ys, rows, loaded: selection.isLoaded(ref) };
}), null, 2));
await browser.close();
