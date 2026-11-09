import { expect, test, type Page } from "@playwright/test";
import { scrollMetrics, scrollTo } from "./stage-support";
import { act, lastView, openView } from "./view-controls-support";

/**
 * Zoom smoothness, measured per animation frame while a gesture runs: the
 * displayed width of page 1 (its scale), where a point of the page that was
 * under the pointer ends up, and how many frames showed no loaded page.
 */
interface Frames {
  scales: number[];
  drift: number;
  blankFrames: number;
  settledBlankMs: number;
}

/** Run `events` (one per frame) at (x, y) over the viewport and sample every frame. */
async function measure(
  page: Page,
  events: { deltaY: number; ctrlKey?: boolean; metaKey?: boolean }[],
  settleMs = 900,
): Promise<Frames> {
  const box = (await page.locator(".viewport").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;
  return page.evaluate(
    async ({ events, x, y, settleMs }) => {
      // Sample two frames after the input, once painted: a rAF callback runs
      // before the frame's layout and resize observers, so reading the layout
      // there could show a state that is never on screen.
      const painted = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 0)),
          ),
        );
      const viewport = document.querySelector(".viewport")!;
      // The page under the pointer, so its point can be followed.
      const index = (
        document
          .elementsFromPoint(x, y)
          .find((element) => element.classList.contains("page")) ??
        document.querySelector(".page")!
      ).getAttribute("data-page-index");
      const first = () =>
        document
          .querySelector(`.page[data-page-index="${index}"]`)!
          .getBoundingClientRect();
      const loaded = () =>
        Array.from(
          document.querySelectorAll<HTMLImageElement>(".page img"),
        ).some((image) => {
          const rect = image.getBoundingClientRect();
          const frame = viewport.getBoundingClientRect();
          return (
            image.complete &&
            image.naturalWidth > 0 &&
            rect.bottom > frame.top &&
            rect.top < frame.bottom
          );
        });
      const start = first();
      const anchor = {
        u: (x - start.left) / start.width,
        v: (y - start.top) / start.height,
      };
      const scales: number[] = [start.width];
      let drift = 0;
      let blankFrames = 0;
      const sample = (): void => {
        const rect = first();
        scales.push(rect.width);
        drift = Math.max(
          drift,
          Math.abs(rect.left + anchor.u * rect.width - x),
          Math.abs(rect.top + anchor.v * rect.height - y),
        );
        if (!loaded()) {
          blankFrames++;
        }
      };
      for (const event of events) {
        viewport.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: event.deltaY,
            deltaMode: 0,
            ctrlKey: event.ctrlKey ?? true,
            metaKey: event.metaKey ?? false,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
        await painted();
        sample();
      }
      // After the gesture: wait for the re-render and count time with no loaded page.
      let blankMs = 0;
      let last = performance.now();
      const end = last + settleMs;
      while (performance.now() < end) {
        await painted();
        const now = performance.now();
        sample();
        if (!loaded()) {
          blankMs += now - last;
        }
        last = now;
      }
      return {
        scales,
        drift,
        blankFrames,
        settledBlankMs: Math.round(blankMs),
      };
    },
    { events, x, y, settleMs },
  );
}

/** The largest ratio between the displayed widths of two consecutive frames. */
function biggestStep(scales: number[]): number {
  let worst = 1;
  for (let i = 1; i < scales.length; i++) {
    const ratio = scales[i]! / scales[i - 1]!;
    worst = Math.max(worst, ratio, 1 / ratio);
  }
  return worst;
}

const pinchOut = (frames: number, deltaY = -2.5) =>
  Array.from({ length: frames }, () => ({ deltaY }));

test("pinch zoom follows the fingers: no large per-frame jump, the scale tracks the deltas, the point under the pointer stays put, bounded blank time", async ({
  page,
}) => {
  await openView(page, { defaultZoom: "actual", smoothScrolling: true });
  await expect
    .poll(async () => (await lastView(page))?.zoomPercent, { timeout: 15_000 })
    .toBe(100);
  await page.waitForTimeout(300);
  const before = (await lastView(page))!.zoomPercent;
  const frames = await measure(page, pinchOut(40));
  console.log(
    "PINCH",
    JSON.stringify({
      biggestStep: biggestStep(frames.scales),
      drift: Math.round(frames.drift * 10) / 10,
      blankFrames: frames.blankFrames,
      settledBlankMs: frames.settledBlankMs,
      from: frames.scales[0],
      to: frames.scales.at(-1),
    }),
  );
  // Forty deltas of -2.5 are a total of -100: the scale follows exp(100 / 100).
  const expected = Math.min(4, Math.exp(1));
  await expect
    .poll(async () => (await lastView(page))!.zoomPercent / before)
    .toBeGreaterThan(expected * 0.9);
  expect((await lastView(page))!.zoomPercent / before).toBeLessThan(
    expected * 1.1,
  );
  expect(biggestStep(frames.scales)).toBeLessThan(1.06);
  expect(frames.drift).toBeLessThan(6);
  expect(frames.blankFrames).toBeLessThanOrEqual(2);
  expect(frames.settledBlankMs).toBeLessThan(250);
});

test("pinching in is as smooth as pinching out", async ({ page }) => {
  // Narrower than the zoomed page, so the pointer's point can stay put (a page
  // narrower than the editor is centred again as it shrinks).
  await page.setViewportSize({ width: 500, height: 1200 });
  await openView(page, { defaultZoom: 400, smoothScrolling: true });
  // From the middle of the document, so no edge clamps the point.
  const metrics = await scrollMetrics(page);
  await scrollTo(page, {
    left: (metrics.scrollWidth - metrics.clientWidth) / 2,
    top: 3000,
  });
  await page.waitForTimeout(200);
  const frames = await measure(page, pinchOut(20, 2.5));
  console.log(
    "PINCH-IN",
    JSON.stringify({
      biggestStep: biggestStep(frames.scales),
      drift: frames.drift,
      blankFrames: frames.blankFrames,
      settledBlankMs: frames.settledBlankMs,
    }),
  );
  expect(biggestStep(frames.scales)).toBeLessThan(1.06);
  expect(frames.drift).toBeLessThan(6);
  expect(frames.settledBlankMs).toBeLessThan(250);
});

test("Ctrl+wheel notches, zoom buttons and keys step through the zoom levels without a scale jump larger than a step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 1200 });
  await openView(page, { defaultZoom: 200, smoothScrolling: true });
  const metrics = await scrollMetrics(page);
  await scrollTo(page, {
    left: (metrics.scrollWidth - metrics.clientWidth) / 2,
    top: 3000,
  });
  await page.waitForTimeout(200);
  const notch = await measure(page, [{ deltaY: -100 }, { deltaY: -100 }], 600);
  console.log(
    "NOTCH",
    JSON.stringify({
      biggestStep: biggestStep(notch.scales),
      drift: notch.drift,
      blankFrames: notch.blankFrames,
      settledBlankMs: notch.settledBlankMs,
    }),
  );
  // A notch is one step of 1.2 about the pointer, so this only rules out a jump of more than one.
  expect(biggestStep(notch.scales)).toBeLessThan(1.4);
  // Looser than a pinch: a loaded machine can sample a frame late.
  expect(notch.drift).toBeLessThan(24);
  expect(notch.settledBlankMs).toBeLessThan(250);
  const button = await page.evaluate(async () => {
    const widths: number[] = [];
    const page0 = () =>
      document.querySelector(".page")!.getBoundingClientRect().width;
    widths.push(page0());
    (
      document.querySelector(
        'button[aria-label="Zoom in"]',
      ) as HTMLButtonElement | null
    )?.click();
    // Sample once a frame is painted.
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 0)),
        ),
      );
      widths.push(page0());
    }
    return widths;
  });
  console.log(
    "BUTTON",
    JSON.stringify({
      biggestStep: biggestStep(button),
      from: button[0],
      to: button.at(-1),
    }),
  );
  expect(button.at(-1)).toBeGreaterThan(button[0]!);
  expect(biggestStep(button)).toBeLessThan(1.22);
  await act(page, { action: "zoomOut" });
});

test("a pinch zooms as usual with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openView(page, { defaultZoom: "actual", smoothScrolling: true });
  const frames = await measure(page, pinchOut(20), 500);
  expect(frames.scales.at(-1)).toBeGreaterThan(frames.scales[0]!);
  expect(frames.drift).toBeLessThan(6);
});

test("a jump to a page right after a zoom step lands on that page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await openView(page, { defaultZoom: 100 });
  await page.waitForTimeout(400);
  await act(page, { action: "zoomIn" });
  await act(page, { action: "goToPage", page: 5 });
  await page.waitForTimeout(900);
  const offset = await page.evaluate(() => {
    const top = document
      .querySelector(".viewport")!
      .getBoundingClientRect().top;
    return (
      document
        .querySelector('.page[data-page-index="4"]')!
        .getBoundingClientRect().top - top
    );
  });
  expect(Math.abs(offset)).toBeLessThan(16);
});

/**
 * The Stage writes a zoom step's camera and the pages' layout in one state
 * change, so no frame can show the old pages at the new scroll offset. (With
 * EmbedPDF 2 the scroll that keeps the step's anchor was applied in a
 * requestAnimationFrame while React laid the pages out in a task of its own,
 * and a busy main thread painted a frame between the two: in a long document
 * a blank viewport or another page.) The test keeps that guard: it delays
 * React's scheduler (it posts its work through a MessageChannel) by more than
 * a frame, and the page at the viewer's centre must stay the same in every
 * painted frame.
 */
test("a zoom step never paints the old pages at the new scroll offset, however late React lays them out", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeChannel = window.MessageChannel;
    window.MessageChannel = class extends NativeChannel {
      constructor() {
        super();
        const post = this.port2.postMessage.bind(this.port2);
        this.port2.postMessage = (message: unknown) => {
          const delay =
            (window as unknown as { __schedulerDelay?: number })
              .__schedulerDelay ?? 0;
          setTimeout(() => post(message), delay);
        };
      }
    };
  });
  await page.setViewportSize({ width: 800, height: 600 });
  await openView(
    page,
    { defaultZoom: 100, smoothScrolling: false },
    "slim",
    "&pdf=large.pdf",
  );
  await act(page, { action: "goToPage", page: 300 });
  await page.waitForTimeout(800);
  const painted = await page.evaluate(async () => {
    (window as unknown as { __schedulerDelay: number }).__schedulerDelay = 40;
    const viewport = document.querySelector<HTMLElement>(".viewport")!;
    const frame = viewport.getBoundingClientRect();
    const centre = frame.top + frame.height / 2;
    const pageAtCentre = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(".page[data-page-index]"),
      ).find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= centre && rect.bottom >= centre;
      });
    // Sample what is about to be painted: a ResizeObserver created inside this
    // frame's rAF is delivered after the others, just before paint.
    const pages: (string | undefined)[] = [];
    let observer: ResizeObserver | undefined;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
    document.body.append(probe);
    let live = true;
    let wide = false;
    const tick = (): void => {
      observer?.disconnect();
      observer = new ResizeObserver(() =>
        pages.push(pageAtCentre()?.dataset.pageIndex),
      );
      observer.observe(probe);
      wide = !wide;
      probe.style.width = wide ? "2px" : "1px";
      if (live) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    const hostSend = (window as unknown as { hostSend(message: unknown): void })
      .hostSend;
    for (const action of ["zoomIn", "zoomIn", "zoomOut", "zoomOut"]) {
      hostSend({ type: "action", action: { action } });
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    live = false;
    observer?.disconnect();
    probe.remove();
    return pages;
  });
  expect(painted.length).toBeGreaterThan(20);
  // Zooming about the viewer's centre keeps the same page there, in every frame.
  expect(new Set(painted)).toEqual(new Set(["299"]));
});
