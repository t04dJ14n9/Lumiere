/**
 * Opening speed in the webview: how soon a note paints after the page
 * starts, and how soon every feature has loaded after that.
 */
import { expect, test } from "@playwright/test";
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
