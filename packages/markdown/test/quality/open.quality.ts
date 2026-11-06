/**
 * Opening speed in the webview: how soon a note paints after the page
 * starts, and how soon every feature has loaded after that.
 */
import { expect, test } from "@playwright/test";
import { webviewSnapshot } from "../../src/plugins/editor/snapshot";
import { servePage } from "../browser/page-server";
import { mermaidNote } from "../support/mermaid-note";
import { note as blocksNote } from "../support/perf-note";
import { budgets, record } from "./budgets";
import { browserFactor, openNote } from "./page";

const notes = {
  small: () => blocksNote(24),
  large: () => blocksNote(16_000),
  diagrams: () => mermaidNote(10),
} as const;

for (const [name, source] of Object.entries(notes) as [
  keyof typeof notes,
  () => string,
][]) {
  test(`a ${name} note paints soon after it opens`, async ({ page }) => {
    const opened = await openNote(page, source());
    const factor = await browserFactor(page);
    const featuresAfterPaint = opened.features - opened.firstPaint;
    record("open", { note: name, ...opened, featuresAfterPaint, factor });
    expect(opened.firstPaint).toBeLessThanOrEqual(
      budgets.firstPaintMs[name] * factor,
    );
    expect(featuresAfterPaint).toBeLessThanOrEqual(
      budgets.featuresAfterPaintMs * factor,
    );
  });
}

/**
 * The page's first HTML already holds the note's first screen
 * (plugins/editor/snapshot.ts). Its text must be painted before the editor,
 * loaded after the page as in the webview (`defer`), has started.
 */
test("a note's first screen is on screen before the editor starts", async ({
  page,
}) => {
  const html = webviewSnapshot(
    blocksNote(24),
    { preset: "obsidian", mode: "livePreview" },
    "mac",
  );
  expect(html).not.toBe("");
  await servePage(
    page,
    `<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/dist/webview/editor.css"></head><body><main id="app">${html}</main><script defer src="/artifacts/fake-host.js"></script></body></html>`,
  );
  const firstVisibleText = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const paint = list
            .getEntries()
            .find((entry) => entry.name === "first-contentful-paint");
          if (paint) {
            resolve(paint.startTime);
          }
        }).observe({ type: "paint", buffered: true });
      }),
  );
  const editorFirstPaint = await page.evaluate(async (source) => {
    window.harness = new window.BrowserHost(source);
    window.harness.trusted = false;
    window.harness.features = {};
    window.harness.videoDetails = {};
    window.harness.notes = {};
    await window.harness.open("obsidian");
    while (performance.getEntriesByName("mw:first-paint").length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return performance.getEntriesByName("mw:first-paint")[0]!.startTime;
  }, blocksNote(24));
  const factor = await browserFactor(page);
  record("open", {
    note: "firstVisibleText",
    firstVisibleText,
    editorFirstPaint,
    factor,
  });
  expect(firstVisibleText).toBeLessThan(editorFirstPaint);
});

/** Frontmatter of `count` properties: text, lists, nested maps, dates, links. */
function frontmatterNote(count: number): string {
  const lines = ["---"];
  for (let i = 0; i < count; i++) {
    switch (i % 5) {
      case 0:
        lines.push(`title_${i}: "A long string value for property ${i}"`);
        break;
      case 1:
        lines.push(
          `tags_${i}:`,
          ...Array.from({ length: 6 }, (_, j) => `  - tag-${i}-${j}`),
        );
        break;
      case 2:
        lines.push(`nested_${i}:`, `  alpha: ${i}`, `  beta: true`);
        break;
      case 3:
        lines.push(`date_${i}: 2026-0${1 + (i % 9)}-${10 + (i % 18)}`);
        break;
      default:
        lines.push(`links_${i}: "[[Other]]"`);
    }
  }
  lines.push("---", "", "# Body", "", "Short body.", "");
  return lines.join("\n");
}

test("a note with 100 properties loads its features and flushes quickly", async ({
  page,
}) => {
  const opened = await openNote(page, frontmatterNote(100));
  const factor = await browserFactor(page);
  const featuresAfterPaint = opened.features - opened.firstPaint;
  // Saving and every caret capture flush the document, which commits each
  // property input first.
  const flushes = await page.evaluate(async () => {
    const times: number[] = [];
    for (let flush = 0; flush < 3; flush++) {
      const started = performance.now();
      await window.harness.capture();
      times.push(performance.now() - started);
    }
    return times;
  });
  const worstFlush = Math.max(...flushes);
  record("open", {
    note: "frontmatter100",
    ...opened,
    featuresAfterPaint,
    worstFlush,
    factor,
  });
  expect(featuresAfterPaint).toBeLessThanOrEqual(
    budgets.featuresAfterPaintMs * factor,
  );
  expect(worstFlush).toBeLessThanOrEqual(budgets.frontmatterFlushMs * factor);
});
