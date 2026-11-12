// Diagnostic 5: cold geometry on a far page + corrected touch pan/fling.
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:19239";
const CAPS = () => {
  const root = document.getElementById("root");
  const containerKey = Object.keys(root).find((key) =>
    key.startsWith("__reactContainer$"),
  );
  const seen = new Set();
  const stack = [root[containerKey]];
  let interaction = null;
  let selection = null;
  const inspect = (value) => {
    if (!value || typeof value !== "object") return;
    if (!interaction && typeof value.getActiveTool === "function" && typeof value.wouldClaimTouch === "function") interaction = value;
    if (!selection && typeof value.isLoaded === "function" && typeof value.isOverText === "function") selection = value;
  };
  while (stack.length && (!interaction || !selection)) {
    const fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    let hook = fiber.memoizedState;
    let guard = 0;
    while (hook && guard++ < 200) {
      inspect(hook.memoizedState);
      inspect(hook.memoizedState?.value);
      inspect(hook.memoizedState?.current);
      hook = hook.next;
    }
    inspect(fiber.memoizedProps);
    inspect(fiber.memoizedProps?.value);
    inspect(fiber.memoizedProps?.value?.current);
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  window.__caps = { interaction, selection };
  return { foundInteraction: Boolean(interaction), foundSelection: Boolean(selection) };
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1000, height: 700 },
  hasTouch: true,
});
await context.addInitScript(() => {
  window.__events = [];
  document.addEventListener(
    "pointerdown",
    (event) => window.__events.push({ type: "pointerdown", pointerType: event.pointerType }),
    true,
  );
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR", String(error)));
const view = encodeURIComponent(
  JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }),
);
await page.goto(`${BASE}/?toolbar=slim&view=${view}`);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
console.log("caps", await page.evaluate(CAPS));

// Go to page 10 and check geometry status immediately.
await page.evaluate(() =>
  window.hostSend({ type: "action", action: { action: "goToPage", page: 10 } }),
);
await page.locator('.page[data-page-index="9"]').waitFor({ state: "visible" });
console.log(
  "FAR-PAGE",
  JSON.stringify(
    await page.evaluate(() => {
      const { selection } = window.__caps;
      const stage = window.__stage;
      const rect = document.querySelector(".viewport").getBoundingClientRect();
      const box = document.querySelector('.page[data-page-index="9"]').getBoundingClientRect();
      const scale = box.width / 300;
      const viewport = { x: box.x + 250 * scale - rect.left, y: box.y + 250 * scale - rect.top };
      const pageAt = stage.getPageAt(viewport);
      return {
        loaded: pageAt ? selection.isLoaded(pageAt.ref) : null,
        ref: pageAt?.ref,
        cursor: getComputedStyle(document.elementFromPoint(box.x + 90 * scale, box.y + 94 * scale)).cursor,
        box,
        scale,
      };
    }),
  ),
);

// Cold CDP drag with no hover.
{
  const cdp = await context.newCDPSession(page);
  const box = await page.locator('.page[data-page-index="9"]').boundingBox();
  const scale = box.width / 300;
  const x = box.x + 250 * scale;
  const y = box.y + 250 * scale;
  const common = { button: "left", buttons: 1, clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, ...common });
  for (let i = 1; i <= 12; i++)
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: y - 10 * i, ...common });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y: y - 120, ...common, buttons: 0 });
  await page.waitForTimeout(400);
  console.log(
    "COLD-FAR",
    JSON.stringify({
      indexes: await page.locator(".page").evaluateAll((nodes) => nodes.map((n) => Number(n.dataset.pageIndex))),
      view: await page.evaluate(() => window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage),
      loadedAfter: await page.evaluate(() => {
        const { selection } = window.__caps;
        const stage = window.__stage;
        const rect = document.querySelector(".viewport").getBoundingClientRect();
        const box = document.querySelector(".page").getBoundingClientRect();
        const scale = box.width / 300;
        const viewport = { x: box.x + 250 * scale - rect.left, y: box.y + 250 * scale - rect.top };
        const pageAt = stage.getPageAt(viewport);
        return pageAt ? selection.isLoaded(pageAt.ref) : null;
      }),
    }),
  );
  await cdp.detach();
}

// Touch pan at Fit Width with an on-screen blank start point.
{
  const page2 = await context.newPage();
  page2.on("pageerror", (error) => console.log("PAGEERROR2", String(error)));
  const view2 = encodeURIComponent(
    JSON.stringify({ scrollMode: "continuous", defaultZoom: "fitWidth" }),
  );
  await page2.goto(`${BASE}/?toolbar=slim&view=${view2}`);
  await page2.locator(".page img").first().waitFor({ state: "visible" });
  await page2.waitForFunction(() => window.__messages.some((m) => m.patch?.view));
  await page2.waitForTimeout(300);
  await page2.evaluate(CAPS);
  const cdp = await context.newCDPSession(page2);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const box = await page2.locator('.page[data-page-index="0"]').boundingBox();
  const scale = box.width / 300;
  const x = box.x + 250 * scale;
  const y = box.y + 100 * scale;
  console.log("TOUCH start", { x, y, scale, box });
  const metrics = () =>
    page2.evaluate(() => ({
      scrollTop: window.__stage.getScrollMetrics().scrollTop,
      zoom: window.__stage.getZoomLevel(),
      view: window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage,
    }));
  const before = await metrics();
  const touch = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await touch("touchStart", [{ x, y, id: 1 }]);
  const during = [];
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [{ x, y: y - 20 * i, id: 1 }]);
    if (i % 5 === 0) during.push(await metrics());
  }
  await touch("touchEnd", []);
  await page2.waitForTimeout(600);
  const after = await metrics();
  console.log(
    "TOUCH-PAN",
    JSON.stringify({
      before,
      during,
      after,
      indexes: await page2.locator(".page").evaluateAll((nodes) => nodes.map((n) => Number(n.dataset.pageIndex))),
      wouldClaimTouch: await page2.evaluate(() => {
        const { interaction, selection } = window.__caps;
        const stage = window.__stage;
        const rect = document.querySelector(".viewport").getBoundingClientRect();
        const box = document.querySelector(".page").getBoundingClientRect();
        const scale = box.width / 300;
        const viewport = { x: box.x + 250 * scale - rect.left, y: box.y + 100 * scale - rect.top };
        const pageAt = stage.getPageAt(viewport);
        return {
          value: interaction.wouldClaimTouch({
            phase: "down",
            viewport,
            page: pageAt ? { ref: pageAt.ref, point: stage.viewportToPage(pageAt.ref, viewport) } : undefined,
            pointerType: "touch",
            modifiers: { shift: false, alt: false, ctrl: false, meta: false },
            clickCount: 1,
          }),
          activeToolTouch: interaction.getActiveTool().touch ?? null,
          loaded: pageAt ? selection.isLoaded(pageAt.ref) : null,
        };
      }),
      pointerDowns: await page2.evaluate(() => window.__events),
    }),
  );
  await cdp.detach();
  await page2.close();
}
await browser.close();
