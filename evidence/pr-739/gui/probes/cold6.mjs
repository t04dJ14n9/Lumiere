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
for (const rate of [1, 10, 30]) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
  await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
  await page.locator(".page img").first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
  await page.evaluate(FIND_CAPS);
  const timing = await page.evaluate(async () => {
    const { selection } = window.__caps;
    const ref = { kind: "objectNumber", objectNumber: 7 };
    const t0 = performance.now();
    window.hostSend({ type: "action", action: { action: "goToPage", page: 2 } });
    let mountedAt = null, loadedAt = null;
    for (let i = 0; i < 400; i++) {
      const t = performance.now() - t0;
      const mounted = document.querySelector('.page[data-page-index="1"]');
      const loaded = selection.isLoaded(ref);
      if (mounted && mountedAt === null) mountedAt = t;
      if (loaded) { loadedAt = t; break; }
      await new Promise((r) => setTimeout(r, 2));
    }
    return { mountedAt: Math.round(mountedAt ?? -1), loadedAt: Math.round(loadedAt ?? -1), windowMs: Math.round((loadedAt ?? 0) - (mountedAt ?? 0)) };
  });
  console.log("rate", rate, JSON.stringify(timing));
  await browser.close();
}
