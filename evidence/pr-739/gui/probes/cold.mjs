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
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
console.log("caps", await page.evaluate(CAPS));
const statuses = await page.evaluate(() => {
  const { selection } = window.__caps;
  return Array.from({ length: 20 }, (_, i) => ({ objectNumber: 3 + i, loaded: selection.isLoaded({ kind: "objectNumber", objectNumber: 3 + i }) }));
});
console.log("INITIAL STATUS", JSON.stringify(statuses));
await page.waitForTimeout(1000);
const statuses2 = await page.evaluate(() => {
  const { selection } = window.__caps;
  return Array.from({ length: 20 }, (_, i) => ({ objectNumber: 3 + i, loaded: selection.isLoaded({ kind: "objectNumber", objectNumber: 3 + i }) }));
});
console.log("AFTER 1s", JSON.stringify(statuses2));
await browser.close();
