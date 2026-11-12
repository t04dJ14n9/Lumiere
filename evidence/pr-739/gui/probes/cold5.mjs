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
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
await page.evaluate(FIND_CAPS);
const timing = await page.evaluate(async () => {
  const { selection } = window.__caps;
  const ref = { kind: "objectNumber", objectNumber: 7 };
  const t0 = performance.now();
  window.hostSend({ type: "action", action: { action: "goToPage", page: 2 } });
  const samples = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now() - t0;
    samples.push({ t: Math.round(t), loaded: selection.isLoaded(ref), pageIndex: window.__stage.getCurrentPageIndex(), mounted: [...document.querySelectorAll(".page")].map(n => Number(n.dataset.pageIndex)) });
    if (samples.at(-1).loaded && samples.at(-1).pageIndex === 1) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return { first: samples[0], loadedAt: samples.find(s => s.loaded), page2At: samples.find(s => s.pageIndex === 1), last: samples.at(-1), count: samples.length };
});
console.log(JSON.stringify(timing, null, 2));
await browser.close();
