import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
await page.goto("http://127.0.0.1:19239/?toolbar=slim&view=" + view);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
console.log(JSON.stringify(await page.evaluate(() => {
  const root = document.getElementById("root");
  const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  const seen = new Set(); const stack = [root[key]];
  let caps = [], refs = [];
  while (stack.length) {
    const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f);
    let h = f.memoizedState, g = 0;
    while (h && g++ < 200) {
      const v = h.memoizedState;
      if (v && typeof v === "object") {
        if (typeof v.isLoaded === "function" && typeof v.isOverText === "function") caps.push(v);
        if (v.current && typeof v.current === "object" && "selection" in v.current && "input" in v.current) refs.push(v.current);
      }
      h = h.next;
    }
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
  }
  const selection = caps[0];
  const refCurrent = refs[0];
  // Mark the fiber-found capability for identity comparison.
  selection.__marker = "fiber";
  return {
    capCount: caps.length,
    refCount: refs.length,
    sameObject: refCurrent ? refCurrent.selection === selection : null,
    refSelectionMarker: refCurrent?.selection?.__marker ?? null,
    refInputMode: refCurrent?.input?.mode,
    refInputDirection: refCurrent?.input?.direction,
  };
}), null, 2));
await browser.close();
