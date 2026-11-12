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
for (let attempt = 1; attempt <= 3; attempt++) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  const view = encodeURIComponent(JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }));
  await page.goto("http://127.0.0.1:19239/?toolbar=slim&pdf=large.pdf&view=" + view);
  await page.locator(".page img").first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
  await page.evaluate(FIND_CAPS);
  const box = await page.locator(".page").first().boundingBox();
  const scale = box.width / 300;
  const blank = { x: box.x + 20 * scale, y: box.y + 250 * scale };
  const setup = await page.evaluate(({ x, y }) => {
    window.__cold = { fired: false, down: null };
    const viewport = document.querySelector(".viewport");
    const observer = new MutationObserver(() => {
      if (window.__cold.fired) return;
      if (!document.querySelector('.page[data-page-index="1"]')) return;
      window.__cold.fired = true;
      observer.disconnect();
      const { selection } = window.__caps;
      const stage = window.__stage;
      const rect = viewport.getBoundingClientRect();
      const v = { x: x - rect.left, y: y - rect.top };
      const at = stage.getPageAt(v);
      window.__cold.down = { ref: at?.ref, isLoaded: at ? selection.isLoaded(at.ref) : null, isOverText: at ? selection.isOverText(at.ref, stage.viewportToPage(at.ref, v)) : null, readingPage: window.__messages.filter((m) => m.patch?.view).at(-1).patch.view.readingPage };
      const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, view: window };
      viewport.dispatchEvent(new PointerEvent("pointerdown", opts));
      window.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientY: y - 120 }));
      window.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, clientY: y - 120 }));
    });
    observer.observe(viewport, { childList: true, subtree: true });
    window.hostSend({ type: "action", action: { action: "goToPage", page: 2 } });
    return true;
  }, blank);
  await page.waitForFunction(() => window.__cold.fired, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    down: window.__cold.down,
    indexes: [...document.querySelectorAll(".page")].map((n) => Number(n.dataset.pageIndex)),
    readingPage: window.__messages.filter((m) => m.patch?.view).at(-1).patch.view.readingPage,
    loadedAfter: window.__caps.selection.isLoaded({ kind: "objectNumber", objectNumber: 7 }),
  }));
  console.log("attempt", attempt, "setup", setup, JSON.stringify(after));
  // warm control
  await page.mouse.move(blank.x, blank.y);
  await page.waitForTimeout(500);
  await page.mouse.down();
  await page.mouse.move(blank.x, blank.y - 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log("warm control", JSON.stringify(await page.evaluate(() => ({
    indexes: [...document.querySelectorAll(".page")].map((n) => Number(n.dataset.pageIndex)),
    readingPage: window.__messages.filter((m) => m.patch?.view).at(-1).patch.view.readingPage,
    loaded: window.__caps.selection.isLoaded({ kind: "objectNumber", objectNumber: 7 }),
  }))));
  await context.close();
}
await browser.close();
