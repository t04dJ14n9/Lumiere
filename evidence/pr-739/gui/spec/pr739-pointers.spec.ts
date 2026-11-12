/**
 * TEMPORARY focused browser evidence for PR #739 at exact head
 * c89734d6875e7141378ed0d99e713955d52dd0e6.
 *
 * This head adds NO new Playwright browser spec (its new coverage is unit
 * tests plus a VS Code host-GUI spec). This file lives only in
 * /tmp/pr739-gui-evidence and is behavioral proof, not a new regression spec.
 * It drives the real built viewer served by test/browser/server.mjs on the
 * explicit private port 19239.
 *
 * Assertions per scenario:
 *   S1 mouse blank drag >= 60 CSS px turns forward and back in paged mode;
 *      short drag does not turn; text/selection drag does not turn (S2).
 *   S2 mouse drag from a text glyph selects text, page counter stays put.
 *   S3 trusted pen PointerEvents (CDP pointerType "pen") turn forward/back.
 *   S4 touch is NOT claimed: wouldClaimTouch false, active tool has no
 *      touch:"draw", touch-action unchanged (EmbedPDF Stage baseline),
 *      touch events not preventDefault'ed, one-finger pan moves the Stage,
 *      two-finger pinch zooms, and a paged blank touch fling still turns
 *      through EmbedPDF's native navigation.
 *   S5 switching to continuous mid-drag drops the turn with no bad state;
 *      switching back and dragging again still turns.
 *   S6 at Fit Width a cold blank drag is ignored (pans, no turn, zero handler
 *      step calls) while a loaded-geometry blank drag turns; S6b repeats the
 *      guard check with genuinely cold text layout on large.pdf.
 */
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

const OUT = "/tmp/pr739-gui-evidence";
const SHOTS = `${OUT}/screenshots`;
const results: Record<string, unknown> = {};
const record = (name: string, value: unknown): void => {
  results[name] = value;
};
const shot = (page: Page, name: string): Promise<void> =>
  page
    .screenshot({ path: `${SHOTS}/${name}.png` })
    .then(() => undefined);

/**
 * Find EmbedPDF's live interaction + selection capabilities via React fibers,
 * and count calls to the paged-drag handler's `step` verb. The count wraps the
 * useRef `current` setter, so it survives every re-render (including page
 * turns) that replaces `latest.current.input`.
 */
const FIND_CAPS = (): {
  interaction: boolean;
  selection: boolean;
  stepHook: boolean;
  sameObject: boolean;
} => {
  const win = window as unknown as Record<string, unknown>;
  const root = document.getElementById("root")!;
  const key = Object.keys(root).find((name) =>
    name.startsWith("__reactContainer$"),
  )!;
  const seen = new Set<unknown>();
  const stack: any[] = [(root as unknown as Record<string, unknown>)[key]];
  let interaction: any = null;
  let selection: any = null;
  let refHook: any = null;
  let refValue: any = null;
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const candidate = value as Record<string, unknown>;
    if (
      !interaction &&
      typeof candidate.getActiveTool === "function" &&
      typeof candidate.wouldClaimTouch === "function"
    ) {
      interaction = candidate;
    }
    if (
      !selection &&
      typeof candidate.isLoaded === "function" &&
      typeof candidate.isOverText === "function"
    ) {
      selection = candidate;
    }
    const current = (candidate as any).current;
    if (
      !refHook &&
      current &&
      typeof current === "object" &&
      "selection" in current &&
      "input" in current
    ) {
      refHook = candidate;
      refValue = current;
    }
  };
  while (stack.length && (!interaction || !selection || !refHook)) {
    const fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    let hook = fiber.memoizedState;
    let guard = 0;
    while (hook && guard++ < 200) {
      inspect(hook.memoizedState);
      inspect((hook.memoizedState as any)?.value);
      inspect((hook.memoizedState as any)?.current);
      hook = hook.next;
    }
    inspect(fiber.memoizedProps);
    inspect((fiber.memoizedProps as any)?.value);
    inspect(((fiber.memoizedProps as any)?.value as any)?.current);
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  win.__caps = { interaction, selection };
  win.__steps = [];
  if (refHook) {
    const wrap = (value: any): any => {
      if (
        value?.input &&
        typeof value.input.step === "function" &&
        !value.input.__pr739Wrapped
      ) {
        const original = value.input.step;
        value.input.step = (...args: any[]) => {
          (win.__steps as number[]).push(args[0]);
          return original(...args);
        };
        value.input.__pr739Wrapped = true;
      }
      return value;
    };
    let current = wrap(refHook.current);
    Object.defineProperty(refHook, "current", {
      configurable: true,
      get: () => current,
      set: (next: any) => {
        current = wrap(next);
      },
    });
  }
  return {
    interaction: Boolean(interaction),
    selection: Boolean(selection),
    stepHook: Boolean(refHook),
    sameObject: Boolean(refValue && refValue.selection === selection),
  };
};

/** Record pointer/touch listeners and event defaultPrevented flags. */
const INSTRUMENT = (): void => {
  const win = window as unknown as Record<string, unknown>;
  win.__events = [];
  win.__listeners = [];
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (typeof type === "string" && /^(touch|pointer)/.test(type)) {
      (win.__listeners as unknown[]).push({
        type,
        target:
          this === window
            ? "window"
            : this === document
              ? "document"
              : String((this as Element).className ?? (this as Node).nodeName).slice(0, 40),
        passive: typeof options === "object" ? Boolean(options?.passive) : false,
      });
    }
    return original.call(this, type, listener, options);
  };
  const rec = (event: Event): void => {
    const pointer = event as PointerEvent;
    (win.__events as unknown[]).push({
      type: event.type,
      pointerType: pointer.pointerType ?? null,
      prevented: event.defaultPrevented,
    });
  };
  document.addEventListener("pointerdown", rec, true);
  for (const type of [
    "pointerdown",
    "touchstart",
    "touchmove",
    "touchend",
    "pointercancel",
  ]) {
    window.addEventListener(type, rec);
  }
};

const indexes = (page: Page): Promise<number[]> =>
  page
    .locator(".page")
    .evaluateAll((nodes) =>
      nodes.map((node) => Number((node as HTMLElement).dataset.pageIndex)),
    );
const viewState = (page: Page): Promise<any> =>
  page.evaluate(() =>
    (window as any).__messages.filter((m: any) => m.patch?.view).at(-1)?.patch
      ?.view,
  );
const readingPage = async (page: Page): Promise<number> =>
  (await viewState(page)).readingPage;
const lastSelection = (page: Page): Promise<any> =>
  page.evaluate(() =>
    (window as any).__messages
      .flatMap((message: any) =>
        message.type === "patch"
          ? Object.entries(message.patch ?? {})
              .filter(([key]) => key === "selection")
              .map(([, value]) => ({ type: "selection", ...(value as object) }))
          : [message],
      )
      .filter((message: any) => message.type === "selection")
      .at(-1),
  );

async function openViewer(
  page: Page,
  options: { settings?: object; pdf?: string; instrument?: boolean } = {},
): Promise<void> {
  const settings = encodeURIComponent(
    JSON.stringify({ scrollMode: "paged", defaultZoom: "fitPage", ...options.settings }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as any).__errors = errors;
  if (options.instrument) await page.addInitScript(INSTRUMENT);
  await page.goto(
    `/?toolbar=slim&pdf=${options.pdf ?? "outline.pdf"}&view=${settings}`,
  );
  await expect(page.locator(".page img").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() =>
    (window as any).__messages.some((m: any) => m.patch?.view),
  );
  await page.evaluate(() =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ),
  );
}

/** PDF-point -> screen pixel helper for the currently mounted page. */
async function geometry(page: Page) {
  const box = (await page.locator(".page").first().boundingBox())!;
  const scale = box.width / 300;
  return {
    box,
    scale,
    at: (x: number, y: number) => ({ x: box.x + x * scale, y: box.y + y * scale }),
  };
}

const BLANK = { x: 250, y: 250 }; // outline.pdf: clear of the x=72..228,y=300..330 link
const TEXT = { x: 90, y: 94 }; // "Synthetic page 1" glyph line
const LARGE_BLANK = { x: 20, y: 250 }; // large.pdf: blank left margin corridor
const FIT_WIDTH_BLANK = { x: 250, y: 100 }; // on-screen at Fit Width

async function loadGeometry(page: Page): Promise<boolean> {
  const g = await geometry(page);
  const text = g.at(TEXT.x, TEXT.y);
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(text.x + (i % 2), text.y);
    const cursor = await page.evaluate(
      ([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
      [text.x, text.y],
    );
    if (cursor === "text") return true;
    await page.waitForTimeout(50);
  }
  return false;
}

async function mouseDrag(page: Page, from: { x: number; y: number }, dy: number, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + dy, { steps });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** Trusted pen/mouse events through CDP (pointerType is a real CDP field). */
async function cdpDrag(
  page: Page,
  from: { x: number; y: number },
  dy: number,
  pointerType: "pen" | "mouse" = "pen",
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const common = { pointerType, button: "left" as const, buttons: 1, clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, ...common });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: from.x, y: from.y + (dy * i) / 12, ...common,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: from.x, y: from.y + dy, ...common, buttons: 0,
  });
  await cdp.detach();
  await page.waitForTimeout(400);
}

async function touchConsent(page: Page, client: { x: number; y: number }): Promise<any> {
  return page.evaluate(({ x, y }) => {
    const { interaction, selection } = (window as any).__caps;
    const stage = (window as any).__stage;
    const rect = document.querySelector(".viewport")!.getBoundingClientRect();
    const viewport = { x: x - rect.left, y: y - rect.top };
    const at = stage.getPageAt(viewport);
    const point = at ? stage.viewportToPage(at.ref, viewport) : undefined;
    const sample = {
      phase: "down",
      viewport,
      page: at ? { ref: at.ref, point } : undefined,
      pointerType: "touch",
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      clickCount: 1,
    };
    return {
      wouldClaimTouch: interaction.wouldClaimTouch(sample),
      activeToolId: interaction.getActiveToolId(),
      activeToolTouch: interaction.getActiveTool().touch ?? null,
      activeToolEnables: [...interaction.getActiveTool().enables],
      isLoaded: at ? selection.isLoaded(at.ref) : null,
      isOverText: at && point ? selection.isOverText(at.ref, point) : null,
    };
  }, client);
}

async function cdpTouch(page: Page): Promise<{
  session: any;
  send: (type: string, touchPoints: { x: number; y: number; id: number }[]) => Promise<void>;
}> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return {
    session: cdp,
    send: async (type, touchPoints) => {
      await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    },
  };
}

test.describe("PR #739 exact-head pointer evidence", () => {
  test.afterAll(() => {
    writeFileSync(`${OUT}/scenarios.json`, JSON.stringify(results, null, 2));
  });

  test("S1 mouse blank drag turns forward and back; short drag does not", async ({ page }) => {
    await openViewer(page);
    const loaded = await loadGeometry(page);
    expect(loaded).toBe(true);
    const g = await geometry(page);
    const blank = g.at(BLANK.x, BLANK.y);
    const before = { indexes: await indexes(page), page: await readingPage(page) };
    await shot(page, "S1-before-page1");
    await mouseDrag(page, blank, -120);
    const forward = { indexes: await indexes(page), page: await readingPage(page) };
    await shot(page, "S1-forward-page2");
    const g2 = await geometry(page);
    const blank2 = g2.at(BLANK.x, BLANK.y);
    await mouseDrag(page, blank2, +120);
    const back = { indexes: await indexes(page), page: await readingPage(page) };
    await shot(page, "S1-back-page1");
    await mouseDrag(page, blank, -30);
    const short = { indexes: await indexes(page), page: await readingPage(page) };
    expect(forward.page).toBe(2);
    expect(forward.indexes).toEqual([1]);
    expect(back.page).toBe(1);
    expect(back.indexes).toEqual([0]);
    expect(short.page).toBe(1);
    record("S1", {
      result: "pass",
      before, forward, back, short,
      dragCssPx: 120, shortDragCssPx: 30, thresholdCssPx: 60,
      geometryLoadedBeforeDrag: loaded,
      pageErrors: (page as any).__errors,
      screenshots: ["S1-before-page1", "S1-forward-page2", "S1-back-page1"],
    });
  });

  test("S2 mouse drag from text selects text and does not turn", async ({ page }) => {
    await openViewer(page);
    expect(await loadGeometry(page)).toBe(true);
    const g = await geometry(page);
    const from = g.at(74, TEXT.y);
    const to = g.at(205, TEXT.y);
    const before = await readingPage(page);
    await mouseDrag(page, from, 0, 1);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const selection = await lastSelection(page);
    const after = await readingPage(page);
    await shot(page, "S2-text-selection-no-turn");
    expect(selection?.selection?.kind).toBe("text");
    expect(String(selection?.selection?.text)).toContain("Synthetic");
    expect(after).toBe(before);
    expect(await indexes(page)).toEqual([0]);
    record("S2", {
      result: "pass", before, after,
      selectionKind: selection?.selection?.kind,
      selectedText: selection?.selection?.text,
      pageErrors: (page as any).__errors,
      screenshots: ["S2-text-selection-no-turn"],
    });
  });

  test("S3 trusted pen pointer events turn a blank page forward and back", async ({ page }) => {
    await openViewer(page, { instrument: true });
    expect(await loadGeometry(page)).toBe(true);
    const g = await geometry(page);
    const blank = g.at(BLANK.x, BLANK.y);
    const before = await readingPage(page);
    await cdpDrag(page, blank, -120, "pen");
    const forward = { indexes: await indexes(page), page: await readingPage(page) };
    await shot(page, "S3-pen-forward-page2");
    const g2 = await geometry(page);
    await cdpDrag(page, g2.at(BLANK.x, BLANK.y), +120, "pen");
    const back = { indexes: await indexes(page), page: await readingPage(page) };
    const downs = await page.evaluate(() =>
      (window as any).__events
        .filter((event: any) => event.type === "pointerdown" && event.pointerType)
        .map((event: any) => event.pointerType),
    );
    expect(forward.page).toBe(2);
    expect(back.page).toBe(before);
    expect(downs).toContain("pen");
    record("S3", {
      result: "pass", before, forward, back,
      pointerDownTypes: downs,
      pageErrors: (page as any).__errors,
      screenshots: ["S3-pen-forward-page2"],
    });
  });

  test.describe("touch (hasTouch context)", () => {
    test.use({ hasTouch: true });

    test("S4a native pan and pinch are not suppressed, touch is not claimed", async ({ page }) => {
      await openViewer(page, {
        settings: { scrollMode: "continuous", defaultZoom: "fitWidth" },
        instrument: true,
      });
      const caps = await page.evaluate(FIND_CAPS);
      expect(caps.interaction).toBe(true);
      expect(caps.selection).toBe(true);
      expect(caps.sameObject).toBe(true);
      await page.evaluate(() => {
        (window as any).__gestures = [];
        (window as any).__caps.interaction.onGestureStarted((gesture: any) =>
          (window as any).__gestures.push({ kind: "started", ...gesture }),
        );
      });
      const g = await geometry(page);
      const blank = g.at(FIT_WIDTH_BLANK.x, FIT_WIDTH_BLANK.y);
      const touchAction = await page.evaluate(() => ({
        viewport: getComputedStyle(document.querySelector(".viewport")!).touchAction,
        page: getComputedStyle(document.querySelector(".page")!).touchAction,
        inline: document.querySelector(".viewport")!.getAttribute("style"),
        maxTouchPoints: navigator.maxTouchPoints,
      }));
      const consent = await touchConsent(page, blank);
      const metrics = () =>
        page.evaluate(() => ({
          scrollTop: (window as any).__stage.getScrollMetrics().scrollTop,
          zoom: (window as any).__stage.getZoomLevel(),
          pageWidth: document.querySelector(".page")!.getBoundingClientRect().width,
        }));
      const before = await metrics();
      await shot(page, "S4a-before-pan");
      const touch = await cdpTouch(page);
      await touch.send("touchStart", [{ ...blank, id: 1 }]);
      const during: any[] = [];
      for (let i = 1; i <= 10; i++) {
        await touch.send("touchMove", [{ x: blank.x, y: blank.y - 20 * i, id: 1 }]);
        if (i === 5 || i === 10) during.push(await metrics());
      }
      await touch.send("touchEnd", []);
      await page.waitForTimeout(600);
      const afterPan = await metrics();
      await shot(page, "S4a-after-native-pan");
      // Two-finger pinch out around the middle of the viewport.
      const cx = 500;
      const cy = 350;
      await touch.send("touchStart", [
        { x: cx - 60, y: cy, id: 1 },
        { x: cx + 60, y: cy, id: 2 },
      ]);
      for (let i = 1; i <= 10; i++) {
        await touch.send("touchMove", [
          { x: cx - 60 - 8 * i, y: cy, id: 1 },
          { x: cx + 60 + 8 * i, y: cy, id: 2 },
        ]);
      }
      await touch.send("touchEnd", []);
      await page.waitForTimeout(700);
      const afterPinch = await metrics();
      await shot(page, "S4a-after-native-pinch-zoom");
      const events = await page.evaluate(() => (window as any).__events);
      const listeners = await page.evaluate(() => (window as any).__listeners);
      const gestures = await page.evaluate(() => (window as any).__gestures);
      expect(consent.wouldClaimTouch).toBe(false);
      expect(consent.activeToolTouch).toBeNull();
      expect(consent.activeToolEnables).toContain("scroll");
      expect(afterPan.scrollTop).toBeGreaterThan(before.scrollTop + 100);
      expect(afterPinch.zoom).toBeGreaterThan(afterPan.zoom);
      expect(afterPinch.pageWidth).toBeGreaterThan(afterPan.pageWidth + 50);
      expect(await readingPage(page)).toBe(1);
      expect(events.filter((event: any) => event.type.startsWith("touch") && event.prevented)).toEqual([]);
      expect(gestures.filter((gesture: any) => gesture.pointerType === "touch")).toEqual([]);
      record("S4a", {
        result: "pass",
        touchAction,
        touchConsent: consent,
        before, during, afterPan, afterPinch,
        touchEvents: events.filter((event: any) => event.type.startsWith("touch")),
        pointerDownTypes: events
          .filter((event: any) => event.type === "pointerdown" && event.pointerType)
          .map((event: any) => event.pointerType),
        registeredTouchListeners: listeners.filter((entry: any) => entry.type.startsWith("touch")),
        hubGestures: gestures,
        pageErrors: (page as any).__errors,
        screenshots: ["S4a-before-pan", "S4a-after-native-pan", "S4a-after-native-pinch-zoom"],
      });
    });

    test("S4b a blank-area touch drag still pages through native Stage navigation", async ({ page }) => {
      await openViewer(page, { instrument: true });
      const caps = await page.evaluate(FIND_CAPS);
      expect(caps.interaction).toBe(true);
      expect(caps.selection).toBe(true);
      expect(caps.sameObject).toBe(true);
      const g = await geometry(page);
      const blank = g.at(BLANK.x, BLANK.y);
      const consent = await touchConsent(page, blank);
      const before = { indexes: await indexes(page), page: await readingPage(page) };
      await shot(page, "S4b-before-page1");
      const touch = await cdpTouch(page);
      await touch.send("touchStart", [{ ...blank, id: 1 }]);
      let fingerY = blank.y;
      for (const delta of [25, 45, 65, 85, 105, 125]) {
        fingerY -= delta;
        await touch.send("touchMove", [{ x: blank.x, y: fingerY, id: 1 }]);
      }
      await touch.send("touchEnd", []);
      await page.waitForTimeout(700);
      const after = { indexes: await indexes(page), page: await readingPage(page) };
      await shot(page, "S4b-native-fling-page2");
      const events = await page.evaluate(() => (window as any).__events);
      expect(consent.wouldClaimTouch).toBe(false);
      expect(before.page).toBe(1);
      expect(after.page).toBe(2);
      expect(after.indexes).toEqual([1]);
      expect(events.filter((event: any) => event.type === "pointerdown").map((event: any) => event.pointerType)).toContain("touch");
      record("S4b", {
        result: "pass",
        touchConsent: consent,
        before, after,
        interpretation:
          "This head does not claim touch contacts; the turn comes from EmbedPDF's native paged fling/drag turn stream, not lumia-paged-drag.",
        touchEvents: events.filter((event: any) => event.type.startsWith("touch")),
        pageErrors: (page as any).__errors,
        screenshots: ["S4b-before-page1", "S4b-native-fling-page2"],
      });
    });
  });

  test("S5 mid-drag switch to continuous drops the turn; switching back still turns", async ({ page }) => {
    await openViewer(page);
    expect(await loadGeometry(page)).toBe(true);
    const g = await geometry(page);
    const blank = g.at(BLANK.x, BLANK.y);
    const before = { indexes: await indexes(page), page: await readingPage(page) };
    await shot(page, "S5-before-drag-page1");
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x, blank.y - 40, { steps: 4 });
    await page.evaluate(() =>
      (window as any).hostSend({
        type: "action",
        action: { action: "setScrollMode", scrollMode: "continuous" },
      }),
    );
    await expect.poll(async () => (await viewState(page)).scrollMode).toBe("continuous");
    await page.waitForTimeout(200);
    await page.mouse.move(blank.x, blank.y - 120, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = {
      indexes: await indexes(page),
      page: await readingPage(page),
      scrollMode: (await viewState(page)).scrollMode,
      dataScrollMode: await page.locator(".viewer").getAttribute("data-scroll-mode"),
      regionCount: await page.locator(".region-selection, .region-marquee").count(),
      selection: await lastSelection(page),
    };
    await shot(page, "S5-continuous-no-turn");
    // Positive control: the viewer is still healthy; back to paged, a blank drag turns.
    await page.evaluate(() =>
      (window as any).hostSend({
        type: "action",
        action: { action: "setScrollMode", scrollMode: "paged" },
      }),
    );
    await expect.poll(async () => (await viewState(page)).scrollMode).toBe("paged");
    const gBack = await geometry(page);
    await loadGeometry(page);
    await mouseDrag(page, gBack.at(BLANK.x, BLANK.y), -120);
    const control = { indexes: await indexes(page), page: await readingPage(page) };
    await shot(page, "S5-back-to-paged-turns");
    expect(after.page).toBe(before.page);
    expect(after.scrollMode).toBe("continuous");
    expect(after.dataScrollMode).toBe("continuous");
    expect(after.regionCount).toBe(0);
    expect(after.selection?.selection?.kind ?? null).not.toBe("text");
    expect(control.page).toBe(2);
    record("S5", {
      result: "pass", before, after, control,
      pageErrors: (page as any).__errors,
      screenshots: ["S5-before-drag-page1", "S5-continuous-no-turn", "S5-back-to-paged-turns"],
    });
  });

  test("S6 loaded geometry required: cold blank drag pans, warm blank drag turns", async ({ page }) => {
    await openViewer(page, { settings: { defaultZoom: "fitWidth" }, instrument: true });
    const caps = await page.evaluate(FIND_CAPS);
    expect(caps.interaction).toBe(true);
    expect(caps.selection).toBe(true);
    expect(caps.stepHook).toBe(true);
    expect(caps.sameObject).toBe(true); // the stubbed capability IS the handler's own
    expect(await loadGeometry(page)).toBe(true);
    const g = await geometry(page);
    const blank = g.at(FIT_WIDTH_BLANK.x, FIT_WIDTH_BLANK.y);
    const state = () =>
      page.evaluate(() => ({
        readingPage: (window as any).__messages
          .filter((message: any) => message.patch?.view)
          .at(-1)?.patch?.view?.readingPage,
        scrollTop: (window as any).__stage.getScrollMetrics().scrollTop,
        steps: (window as any).__steps.splice(0),
      }));
    const before = await state();
    await shot(page, "S6-before-page1-fitwidth");
    // Simulate cold geometry at the handler's input boundary: outline.pdf warms
    // text layout eagerly, so a literal pre-load press has only a ~5 ms window.
    // identity check above proves this is the very object the handler reads.
    await page.evaluate(() => {
      const { selection } = (window as any).__caps;
      (window as any).__originalIsLoaded = selection.isLoaded;
      selection.isLoaded = () => false;
    });
    await mouseDrag(page, blank, -120);
    const cold = await state();
    await shot(page, "S6-cold-pan-no-turn");
    await page.evaluate(() => {
      const { selection } = (window as any).__caps;
      selection.isLoaded = (window as any).__originalIsLoaded;
    });
    const geometryRestored = await page.evaluate(({ x, y }) => {
      const { selection } = (window as any).__caps;
      const stage = (window as any).__stage;
      const rect = document.querySelector(".viewport")!.getBoundingClientRect();
      const at = stage.getPageAt({ x: x - rect.left, y: y - rect.top });
      return at ? selection.isLoaded(at.ref) : null;
    }, blank);
    await mouseDrag(page, blank, -120);
    const warm = await state();
    await shot(page, "S6-warm-turn-page2");
    expect(cold.steps).toEqual([]);
    expect(cold.readingPage).toBe(before.readingPage);
    expect(cold.scrollTop).toBeGreaterThan(before.scrollTop + 60);
    expect(geometryRestored).toBe(true);
    expect(warm.steps).toEqual([1]);
    expect(warm.readingPage).toBe(before.readingPage + 1);
    record("S6", {
      result: "pass",
      fixture: "outline.pdf, paged Fit Width (page taller than viewer, pan room)",
      coldState: "simulated by stubbing selection.isLoaded to false at runtime",
      identityVerified: caps.sameObject,
      before, cold, geometryRestored, warm,
      dragCssPx: 120,
      interpretation:
        "Cold press: lumia-paged-drag made zero step calls, page counter stayed put, Stage panned. Warm press: one handler step turned the page.",
      pageErrors: (page as any).__errors,
      screenshots: ["S6-before-page1-fitwidth", "S6-cold-pan-no-turn", "S6-warm-turn-page2"],
    });
  });

  test("S6b genuine cold geometry: a press before text layout is ready is ignored by the handler", async ({ page }) => {
    await openViewer(page, { pdf: "large.pdf" });
    const caps = await page.evaluate(FIND_CAPS);
    expect(caps.stepHook).toBe(true);
    const g = await geometry(page);
    const blank = g.at(LARGE_BLANK.x, LARGE_BLANK.y);
    // large.pdf warms only mounted pages. Dispatch the press from inside the
    // page at the instant page 2 mounts, while its geometry is still cold.
    await page.evaluate(({ x, y }) => {
      const win = window as any;
      win.__cold = { fired: false, down: null };
      win.__steps.length = 0;
      const viewport = document.querySelector(".viewport")!;
      const observer = new MutationObserver(() => {
        if (win.__cold.fired) return;
        if (!document.querySelector('.page[data-page-index="1"]')) return;
        win.__cold.fired = true;
        observer.disconnect();
        const { selection } = win.__caps;
        const stage = win.__stage;
        const rect = viewport.getBoundingClientRect();
        const v = { x: x - rect.left, y: y - rect.top };
        const at = stage.getPageAt(v);
        win.__cold.down = {
          ref: at?.ref,
          isLoaded: at ? selection.isLoaded(at.ref) : null,
          isOverText: at
            ? selection.isOverText(at.ref, stage.viewportToPage(at.ref, v))
            : null,
          readingPageAtDown: win.__messages
            .filter((message: any) => message.patch?.view)
            .at(-1)?.patch?.view?.readingPage,
        };
        const opts: any = {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: y,
          view: window,
        };
        viewport.dispatchEvent(new PointerEvent("pointerdown", opts));
        window.dispatchEvent(
          new PointerEvent("pointermove", { ...opts, clientY: y - 120 }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", { ...opts, buttons: 0, clientY: y - 120 }),
        );
      });
      observer.observe(viewport, { childList: true, subtree: true });
      win.hostSend({ type: "action", action: { action: "goToPage", page: 2 } });
    }, blank);
    await page.waitForFunction(() => (window as any).__cold.fired, null, { timeout: 20_000 });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      down: (window as any).__cold.down,
      steps: (window as any).__steps,
      indexes: [...document.querySelectorAll(".page")].map((node) =>
        Number((node as HTMLElement).dataset.pageIndex),
      ),
      readingPage: (window as any).__messages
        .filter((message: any) => message.patch?.view)
        .at(-1)?.patch?.view?.readingPage,
    }));
    await shot(page, "S6b-genuine-cold-press");
    expect(after.down.isLoaded).toBe(false);
    expect(after.down.isOverText).toBe(false);
    expect(after.steps).toEqual([]);
    record("S6b", {
      result: "pass",
      fixture: "large.pdf (600 pages): text geometry warms per mounted page",
      coldWindowNote:
        "Measured ~5 ms between page 2 mounting and geometry ready; the in-page MutationObserver press lands inside that window (untrusted DOM PointerEvents; all other scenarios use trusted CDP/Playwright input).",
      after,
      interpretation:
        "At a genuinely cold pointerdown the handler made zero step calls. Any subsequent page movement is EmbedPDF's own Stage pan/turn stream, which this head deliberately leaves in place.",
      pageErrors: (page as any).__errors,
      screenshots: ["S6b-genuine-cold-press"],
    });
  });
});
