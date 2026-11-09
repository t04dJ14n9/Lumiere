import type { Page } from "@playwright/test";

/**
 * The Stage has no scrolling element, so a spec reads the view from the Stage
 * itself: the harness exposes it as `window.__stage` (src/webview/test-hook.ts).
 */
export interface ScrollMetrics {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

type StageProbe = {
  getScrollMetrics(): ScrollMetrics;
  scrollTo(options: {
    left?: number;
    top?: number;
    behavior?: "instant" | "smooth";
  }): void;
  scrollBy(options: {
    left?: number;
    top?: number;
    behavior?: "instant" | "smooth";
  }): void;
};

/** What a native scroller would report: offsets and sizes, in screen pixels. */
export function scrollMetrics(page: Page): Promise<ScrollMetrics> {
  return page.evaluate(() =>
    (window as unknown as { __stage: StageProbe }).__stage.getScrollMetrics(),
  );
}

export const scrollTop = async (page: Page) =>
  (await scrollMetrics(page)).scrollTop;

export const scrollLeft = async (page: Page) =>
  (await scrollMetrics(page)).scrollLeft;

/** How far the view can scroll down. */
export const maxScrollTop = async (page: Page) => {
  const metrics = await scrollMetrics(page);
  return metrics.scrollHeight - metrics.clientHeight;
};

/** How far the view can scroll to the right. */
export const maxScrollLeft = async (page: Page) => {
  const metrics = await scrollMetrics(page);
  return metrics.scrollWidth - metrics.clientWidth;
};

/** Move the view at once, like `Element.scrollTo({ behavior: "instant" })`. */
export function scrollTo(
  page: Page,
  position: { left?: number; top?: number },
): Promise<void> {
  return page.evaluate(
    (position) =>
      (window as unknown as { __stage: StageProbe }).__stage.scrollTo({
        ...position,
        behavior: "instant",
      }),
    position,
  );
}

/** Move the view by an amount at once, like `Element.scrollBy({ behavior: "instant" })`. */
export function scrollBy(
  page: Page,
  amount: { left?: number; top?: number },
): Promise<void> {
  return page.evaluate(
    (amount) =>
      (window as unknown as { __stage: StageProbe }).__stage.scrollBy({
        ...amount,
        behavior: "instant",
      }),
    amount,
  );
}

/** The scroll offset at each of the next `frames` animation frames. */
export function scrollTopPerFrame(
  page: Page,
  frames: number,
): Promise<number[]> {
  return page.evaluate(async (frames) => {
    const stage = (window as unknown as { __stage: StageProbe }).__stage;
    const samples: number[] = [];
    for (let i = 0; i < frames; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(stage.getScrollMetrics().scrollTop);
    }
    return samples;
  }, frames);
}
