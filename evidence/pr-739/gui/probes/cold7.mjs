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
for (let attempt = 1; attempt <= 4; attempt++) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 30 });
  const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
  await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
  await page.locator(".page img").first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
  await page.evaluate(FIND_CAPS);
  const box = await page.locator(".page").first().boundingBox();
  const scale = box.width / 300;
  const blank = { x: box.x + 20 * scale, y: box.y + 250 * scale };
  await page.evaluate(() => {
    window.__downChecks = [];
    document.addEventListener("pointerdown", (event) => {
      const { selection } = window.__caps;
      const stage = window.__stage;
      const rect = document.querySelector(".viewport").getBoundingClientRect();
      const v = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const at = stage.getPageAt(v);
      window.__downChecks.push({ pointerType: event.pointerType, ref: at?.ref, isLoaded: at ? selection.isLoaded(at.ref) : null });
    }, true);
  });
  const before = await page.evaluate(() => window.__messages.filter((m) => m.patch?.view).at(-1).patch.view.readingPage);
  await page.evaluate(() => window.hostSend({ type: "action", action: { action: "goToPage", page: 2 } }));
  await page.waitForFunction(() => Boolean(document.querySelector('.page[data-page-index="1"]')), null, { polling: "raf", timeout: 20000 });
  const common = { button: "left", buttons: 1, clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: blank.x, y: blank.y, ...common });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: blank.x, y: blank.y - 120, ...common });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: blank.x, y: blank.y - 120, ...common, buttons: 0 });
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => ({
    downChecks: window.__downChecks,
    indexes: [...document.querySelectorAll(".page")].map((n) => Number(n.dataset.pageIndex)),
    readingPage: window.__messages.filter((m) => m.patch?.view).at(-1).patch.view.readingPage,
  }));
  console.log("attempt", attempt, "before", before, JSON.stringify(out));
  await context.close();
}
await browser.close();
