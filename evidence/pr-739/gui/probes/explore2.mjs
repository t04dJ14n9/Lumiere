// Exploratory probe 2 for PR #739 pointer evidence. Not part of the source tree.
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:19239";

const pageIndexes = (page) =>
  page.locator(".page").evaluateAll((nodes) =>
    nodes.map((node) => Number(node.dataset.pageIndex)),
  );
const lastView = (page) =>
  page.evaluate(() =>
    window.__messages.filter((message) => message.patch?.view).at(-1)?.patch
      ?.view,
  );
const lastSelection = (page) =>
  page.evaluate(() => {
    const messages = window.__messages.flatMap((message) =>
      message.type === "patch"
        ? Object.entries(message.patch ?? {})
            .filter(([key]) => key === "selection")
            .map(([, value]) => ({ type: "selection", ...value }))
        : [message],
    );
    return messages.filter((message) => message.type === "selection").at(-1);
  });

async function openViewer(page, settings) {
  const view = encodeURIComponent(
    JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage", ...settings }),
  );
  await page.goto(`${BASE}/?toolbar=slim&view=${view}`);
  await page.locator(".page img").first().waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    window.__messages.some((message) => message.patch?.view),
  );
  await page.evaluate(() =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ),
  );
}

async function points(page) {
  const box = await page.locator('.page').first().boundingBox();
  const scale = box.width / 300;
  return {
    blank: { x: box.x + 250 * scale, y: box.y + 250 * scale },
    text: { x: box.x + 90 * scale, y: box.y + 94 * scale },
    box,
    scale,
  };
}

async function cursorAt(page, point) {
  return page.evaluate(
    ([x, y]) =>
      getComputedStyle(document.elementFromPoint(x, y)).cursor,
    [point.x, point.y],
  );
}

async function loadGeometry(page, text) {
  // Hovering a page makes EmbedPDF's selection handler ensure its geometry.
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(text.x + (i % 2), text.y);
    if ((await cursorAt(page, text)) === "text") return true;
    await page.waitForTimeout(50);
  }
  return false;
}

async function drag(page, from, dy, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + dy, { steps });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1000, height: 700 },
  hasTouch: true,
});
await context.addInitScript(() => {
  window.__events = [];
  window.__listeners = [];
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (typeof type === "string" && /^(touch|pointer)/.test(type)) {
      window.__listeners.push({
        type,
        target:
          this === window
            ? "window"
            : this === document
              ? "document"
              : this.className?.toString?.().slice(0, 40) ?? this.nodeName,
        passive: typeof options === "object" ? options?.passive ?? null : null,
      });
    }
    return original.call(this, type, listener, options);
  };
  const record = (event) =>
    window.__events.push({
      type: event.type,
      pointerType: event.pointerType ?? null,
      prevented: event.defaultPrevented,
    });
  document.addEventListener("pointerdown", record, true);
  window.addEventListener("pointerdown", record);
  for (const type of ["touchstart", "touchmove", "touchend", "pointercancel"]) {
    window.addEventListener(type, record);
  }
});
const newPage = async () => {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGEERROR", String(error)));
  return page;
};

// --- loaded geometry: mouse blank drags turn forward and back ---
{
  const page = await newPage();
  await openViewer(page, {});
  const at = await points(page);
  console.log("cursor before load", await cursorAt(page, at.text));
  console.log("geometry loaded", await loadGeometry(page, at.text));
  console.log("cursor after load", await cursorAt(page, at.text));
  const before = await pageIndexes(page);
  await drag(page, at.blank, -120);
  const forward = await pageIndexes(page);
  const at2 = await points(page);
  await drag(page, at2.blank, +120);
  const back = await pageIndexes(page);
  console.log(
    "LOADED-MOUSE",
    JSON.stringify({ before, forward, back, view: await lastView(page) }),
  );
  await page.close();
}

// --- loaded geometry: drag starting on text selects, no page turn ---
{
  const page = await newPage();
  await openViewer(page, {});
  const at = await points(page);
  await loadGeometry(page, at.text);
  const before = await pageIndexes(page);
  await drag(page, { x: at.text.x, y: at.text.y }, 0, 1);
  await page.mouse.move(at.text.x, at.text.y);
  await page.mouse.down();
  await page.mouse.move(at.text.x + 180 * at.scale, at.text.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  console.log(
    "TEXT-DRAG",
    JSON.stringify({
      before,
      after: await pageIndexes(page),
      selection: await lastSelection(page),
      view: await lastView(page),
    }),
  );
  await page.close();
}

// --- cold geometry: direct CDP press, no hover first ---
{
  const page = await newPage();
  const cdp = await context.newCDPSession(page);
  await openViewer(page, {});
  const at = await points(page);
  console.log("COLD cursor", await cursorAt(page, at.text));
  const before = await pageIndexes(page);
  const common = { button: "left", buttons: 1, clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: at.blank.x,
    y: at.blank.y,
    ...common,
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: at.blank.x,
      y: at.blank.y - 10 * i,
      ...common,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: at.blank.x,
    y: at.blank.y - 120,
    ...common,
    buttons: 0,
  });
  await page.waitForTimeout(350);
  console.log(
    "COLD-MOUSE",
    JSON.stringify({
      before,
      after: await pageIndexes(page),
      cursorAfter: await cursorAt(page, at.text),
      pointerDowns: await page.evaluate(() =>
        window.__events.filter((e) => e.type === "pointerdown"),
      ),
    }),
  );
  await cdp.detach();
  await page.close();
}

// --- pen after geometry load ---
{
  const page = await newPage();
  const cdp = await context.newCDPSession(page);
  await openViewer(page, {});
  const at = await points(page);
  await loadGeometry(page, at.text);
  const before = await pageIndexes(page);
  const common = { pointerType: "pen", button: "left", buttons: 1, clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: at.blank.x,
    y: at.blank.y,
    ...common,
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: at.blank.x,
      y: at.blank.y - 10 * i,
      ...common,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: at.blank.x,
    y: at.blank.y - 120,
    ...common,
    buttons: 0,
  });
  await page.waitForTimeout(350);
  const p2 = await points(page);
  const common2 = { ...common };
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: p2.blank.x,
    y: p2.blank.y,
    ...common2,
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: p2.blank.x,
      y: p2.blank.y + 10 * i,
      ...common2,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: p2.blank.x,
    y: p2.blank.y + 120,
    ...common2,
    buttons: 0,
  });
  await page.waitForTimeout(350);
  console.log(
    "PEN-LOADED",
    JSON.stringify({
      before,
      afterForward: await pageIndexes(page),
      view: await lastView(page),
      pointerDownTypes: await page.evaluate(() =>
        window.__events
          .filter((e) => e.type === "pointerdown")
          .map((e) => e.pointerType),
      ),
    }),
  );
  await cdp.detach();
  await page.close();
}

// --- touch: one-finger pan and two-finger pinch at Fit Width (overflow) ---
{
  const page = await newPage();
  const cdp = await context.newCDPSession(page);
  await openViewer(page, { defaultZoom: "fitWidth" });
  const at = await points(page);
  await loadGeometry(page, at.text);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  const metrics = () =>
    page.evaluate(() => {
      const stage = window.__stage;
      return {
        scrollTop: stage.getScrollMetrics().scrollTop,
        zoom: stage.getZoomLevel(),
        pageWidth: document.querySelector(".page")?.getBoundingClientRect().width,
      };
    });
  const before = await metrics();
  const beforeIndexes = await pageIndexes(page);
  const touch = (type, touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await touch("touchStart", [{ x: at.blank.x, y: at.blank.y, id: 1 }]);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [
      { x: at.blank.x, y: at.blank.y - 20 * i, id: 1 },
    ]);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(500);
  const afterPan = await metrics();
  const panIndexes = await pageIndexes(page);
  // Two-finger pinch out around the centre.
  const cx = 500;
  const cy = 350;
  await touch("touchStart", [
    { x: cx - 60, y: cy, id: 1 },
    { x: cx + 60, y: cy, id: 2 },
  ]);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [
      { x: cx - 60 - 8 * i, y: cy, id: 1 },
      { x: cx + 60 + 8 * i, y: cy, id: 2 },
    ]);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(600);
  const afterPinch = await metrics();
  console.log(
    "TOUCH",
    JSON.stringify({
      before,
      afterPan,
      afterPinch,
      beforeIndexes,
      panIndexes,
      pinchIndexes: await pageIndexes(page),
      view: await lastView(page),
      touchEvents: await page.evaluate(() =>
        window.__events.filter((e) => e.type.startsWith("touch")),
      ),
      listeners: await page.evaluate(() =>
        window.__listeners.filter((e) => e.type.startsWith("touch")),
      ),
    }),
  );
  await cdp.detach();
  await page.close();
}

// --- mode switch mid-drag ---
{
  const page = await newPage();
  await openViewer(page, {});
  const at = await points(page);
  await loadGeometry(page, at.text);
  const before = await pageIndexes(page);
  await page.mouse.move(at.blank.x, at.blank.y);
  await page.mouse.down();
  await page.mouse.move(at.blank.x, at.blank.y - 40, { steps: 4 });
  await page.evaluate(() =>
    window.hostSend({
      type: "action",
      action: { action: "setScrollMode", scrollMode: "continuous" },
    }),
  );
  await page.waitForTimeout(200);
  await page.mouse.move(at.blank.x, at.blank.y - 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log(
    "MID-DRAG",
    JSON.stringify({
      before,
      after: await pageIndexes(page),
      view: await lastView(page),
    }),
  );
  await page.close();
}

await browser.close();
