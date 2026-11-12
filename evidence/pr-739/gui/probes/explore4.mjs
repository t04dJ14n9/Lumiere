// Diagnostic 2: trace pointer dispatch through the live interaction hub.
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:19239";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR", String(error)));
const view = encodeURIComponent(
  JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }),
);
await page.goto(`${BASE}/?toolbar=slim&view=${view}`);
await page.locator(".page img").first().waitFor({ state: "visible" });
await page.waitForFunction(() =>
  window.__messages.some((message) => message.patch?.view),
);
await page.waitForTimeout(300);

await page.evaluate(() => {
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
  window.__trace = [];
  const original = interaction.dispatchPointer.bind(interaction);
  interaction.dispatchPointer = (sample) => {
    window.__trace.push({
      phase: sample.phase,
      pointerType: sample.pointerType,
      viewport: sample.viewport,
      hasPage: Boolean(sample.page),
    });
    return original(sample);
  };
  interaction.registerHandler({
    id: "diag-high",
    priority: 100,
    enabledFor: () => true,
    onPointerDown: () => {
      window.__trace.push({ spy: "high-down" });
      return false;
    },
    onPointerUp: () => {
      window.__trace.push({ spy: "high-up" });
    },
  });
  interaction.registerHandler({
    id: "diag-low",
    priority: 11,
    enabledFor: () => true,
    onPointerDown: () => {
      window.__trace.push({ spy: "low-down" });
      return false;
    },
  });
  interaction.onGestureStarted((gesture) =>
    window.__trace.push({ gestureStarted: gesture }),
  );
  interaction.onGestureEnded((gesture) =>
    window.__trace.push({ gestureEnded: gesture }),
  );
  window.__dataScrollMode = document.querySelector(".viewer").dataset.scrollMode;
});

const box = await page.locator('.page[data-page-index="0"]').boundingBox();
const scale = box.width / 300;
const blank = { x: box.x + 150 * scale, y: box.y + 300 * scale };
await page.mouse.move(box.x + 90 * scale, box.y + 94 * scale);
for (let i = 0; i < 30; i++) {
  if (
    (await page.evaluate(
      ([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor,
      [box.x + 90 * scale, box.y + 94 * scale],
    )) === "text"
  ) break;
  await page.waitForTimeout(50);
}
await page.mouse.move(blank.x, blank.y);
await page.mouse.down();
await page.mouse.move(blank.x, blank.y - 120, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(500);
console.log(
  "TRACE",
  JSON.stringify(
    await page.evaluate(() => ({
      dataScrollMode: window.__dataScrollMode,
      trace: window.__trace,
      indexes: [...document.querySelectorAll(".page")].map((node) => Number(node.dataset.pageIndex)),
      view: window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view,
    })),
    null,
    2,
  ),
);

// Direct synthetic dispatch through the hub (bypasses DOM gesture controller).
console.log(
  "DIRECT",
  JSON.stringify(
    await page.evaluate(async () => {
      const { interaction, selection } = window.__caps;
      const stage = window.__stage;
      const rect = document.querySelector(".viewport").getBoundingClientRect();
      const box = document.querySelector('.page[data-page-index="0"]').getBoundingClientRect();
      const scale = box.width / 300;
      const viewport = {
        x: box.x + 150 * scale - rect.left,
        y: box.y + 300 * scale - rect.top,
      };
      const page = stage.getPageAt(viewport);
      const make = (phase, y) => ({
        phase,
        viewport: { x: viewport.x, y },
        page: {
          ...page,
          point: stage.viewportToPage(page.ref, { x: viewport.x, y }),
        },
        project: (ref) => stage.viewportToPage(ref, { x: viewport.x, y }),
        modifiers: { shift: false, alt: false, ctrl: false, meta: false },
        clickCount: 1,
        pointerType: "mouse",
      });
      const before = window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage;
      interaction.dispatchPointer(make("down", viewport.y));
      interaction.dispatchPointer(make("up", viewport.y - 120));
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        before,
        after: window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view?.readingPage,
        indexes: [...document.querySelectorAll(".page")].map((node) => Number(node.dataset.pageIndex)),
        traceTail: window.__trace.slice(-8),
        blankLoaded: selection.isLoaded(page.ref),
      };
    }),
    null,
    2,
  ),
);
await browser.close();
