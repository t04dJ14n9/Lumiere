// Exploratory probe for PR #739 pointer evidence. Not part of the source tree.
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:19239";
const view = encodeURIComponent(
  JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage" }),
);

const pageIndexes = (page) =>
  page.locator(".page").evaluateAll((nodes) =>
    nodes.map((node) => Number(node.dataset.pageIndex)),
  );

const lastView = (page) =>
  page.evaluate(() =>
    window.__messages.filter((message) => message.patch?.view).at(-1)?.patch
      ?.view,
  );

async function openViewer(page) {
  await page.goto(`${BASE}/?toolbar=slim&view=${view}`);
  await page.locator(".page img").first().waitFor({ state: "visible" });
  await page.waitForFunction(
    () => window.__messages.some((message) => message.patch?.view),
  );
  await page.evaluate(() =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ),
  );
}

async function blankPoint(page) {
  const box = await page.locator('.page[data-page-index="0"]').boundingBox();
  const scale = box.width / 300;
  return { x: box.x + 150 * scale, y: box.y + 300 * scale, box, scale };
}

async function textPoint(page) {
  const box = await page.locator('.page[data-page-index="0"]').boundingBox();
  const scale = box.width / 300;
  return { x: box.x + 90 * scale, y: box.y + 94 * scale, box, scale };
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1000, height: 700 },
  hasTouch: true,
});
await context.addInitScript(() => {
  window.__events = [];
  const record = (event) => {
    window.__events.push({
      type: event.type,
      pointerType: event.pointerType ?? null,
      defaultPrevented: event.defaultPrevented,
      x: event.clientX,
      y: event.clientY,
    });
  };
  for (const type of [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "touchstart",
    "touchmove",
    "touchend",
  ]) {
    window.addEventListener(type, record, { passive: true });
  }
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.log("PAGE ERROR", message.text());
});
page.on("pageerror", (error) => console.log("PAGEERROR", String(error)));

await openViewer(page);
console.log(
  "DOM",
  JSON.stringify(
    await page.evaluate(() => {
      const viewport = document.querySelector(".viewport");
      const styles = getComputedStyle(viewport);
      const pageEl = document.querySelector('.page[data-page-index="0"]');
      return {
        viewportClass: viewport?.className,
        viewportTouchAction: styles.touchAction,
        viewportInlineStyle: viewport?.getAttribute("style")?.slice(0, 300),
        pageTouchAction: getComputedStyle(pageEl).touchAction,
        windowStageKeys: Object.keys(window.__stage ?? {}).slice(0, 30),
        pages: document.querySelectorAll(".page").length,
        hasGestureEvent: "GestureEvent" in window,
        maxTouchPoints: navigator.maxTouchPoints,
      };
    }),
  ),
);
console.log("view0", JSON.stringify(await lastView(page)));
console.log("indexes0", await pageIndexes(page));
console.log("blank", JSON.stringify(await blankPoint(page)));
console.log("text", JSON.stringify(await textPoint(page)));

// --- Mouse blank drag up 120 CSS px ---
{
  const at = await blankPoint(page);
  const before = await pageIndexes(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y - 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await pageIndexes(page);
  console.log("MOUSE-UP", JSON.stringify({ before, after, view: await lastView(page) }));
}

// --- Mouse blank drag down 120 CSS px (return) ---
{
  const at = await blankPoint(page);
  const before = await pageIndexes(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await pageIndexes(page);
  console.log("MOUSE-DOWN", JSON.stringify({ before, after, view: await lastView(page) }));
}

// --- Pen via CDP ---
{
  const cdp = await context.newCDPSession(page);
  const at = await blankPoint(page);
  const before = await pageIndexes(page);
  const common = { pointerType: "pen", button: "left", buttons: 1, clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: at.x,
    y: at.y,
    ...common,
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: at.x,
      y: at.y - 10 * i,
      ...common,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: at.x,
    y: at.y - 120,
    ...common,
    buttons: 0,
  });
  await page.waitForTimeout(400);
  const after = await pageIndexes(page);
  console.log(
    "PEN",
    JSON.stringify({
      before,
      after,
      view: await lastView(page),
      pointerTypes: await page.evaluate(() =>
        window.__events
          .filter((event) => event.type === "pointerdown")
          .map((event) => event.pointerType),
      ),
    }),
  );
  await cdp.detach();
}

// --- Touch: one-finger blank drag ---
{
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  const at = await blankPoint(page);
  const before = await pageIndexes(page);
  const viewBefore = await lastView(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [{ x: at.x, y: at.y, id: 1 }]);
  for (let i = 1; i <= 12; i++) {
    await touch("touchMove", [{ x: at.x, y: at.y - 10 * i, id: 1 }]);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(500);
  const after = await pageIndexes(page);
  console.log(
    "TOUCH-1F",
    JSON.stringify({
      before,
      after,
      viewBefore,
      viewAfter: await lastView(page),
      events: await page.evaluate(() =>
        window.__events.slice(-40).map((e) => `${e.type}:${e.pointerType ?? ""}:${e.defaultPrevented ? "P" : ""}`),
      ),
    }),
  );
  await cdp.detach();
}

await browser.close();
