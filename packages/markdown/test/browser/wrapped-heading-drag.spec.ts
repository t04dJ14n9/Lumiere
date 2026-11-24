/**
 * A drag that starts at the first glyph of a soft-wrapped heading with
 * inline code selects from there. CodeMirror's posAtCoords answered a point
 * on the heading's other visual row (its hidden markers are empty widgets),
 * so the selection started mid-heading. Owner-approved regression
 * (2026-11-24). Fixtures are generic.
 */
import { expect, test } from "@playwright/test";
import { open } from "./harness";

const HEADING =
  "### 问题 2：`alpha_id` 64 位（`gamma_delta_query`）与 63 位（`EpsilonLogin` / `ZetaRestrictedEndFlow`）不一致";
const NOTE = `# Note\n\nIntro.\n\n${HEADING}\n\nAfter.\n`;

test("a drag from a wrapped heading's first glyph selects the whole heading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await open(page, NOTE, "obsidian");
  const line = page.locator(".cm-line", { hasText: "问题 2" });
  await expect(line).toBeVisible();
  const lineBox = (await line.boundingBox())!;
  // The heading wraps, which is what puts the other row in reach.
  expect(lineBox.height).toBeGreaterThan(50);
  const first = await line.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    walker.nextNode();
    const range = document.createRange();
    range.setStart(walker.currentNode, 0);
    range.setEnd(walker.currentNode, 1);
    const box = range.getBoundingClientRect();
    return { x: box.x + 1, y: box.y + box.height / 2 };
  });
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(
    lineBox.x + lineBox.width - 2,
    lineBox.y + lineBox.height - 4,
    { steps: 8 },
  );
  await page.mouse.up();
  const start = NOTE.indexOf(HEADING);
  await expect
    .poll(() => page.evaluate(() => window.harness.capture()))
    .toMatchObject({ from: start, to: start + HEADING.length });
});
