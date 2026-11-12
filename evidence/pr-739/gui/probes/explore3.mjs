// Diagnostic: inspect live EmbedPDF capabilities from the React fiber tree.
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
await page.waitForTimeout(400);

const caps = await page.evaluate(() => {
  const root = document.getElementById("root");
  const containerKey = Object.keys(root).find((key) =>
    key.startsWith("__reactContainer$"),
  );
  const fiberRoot = root[containerKey];
  const seen = new Set();
  const stack = [fiberRoot];
  let interaction = null;
  let selection = null;
  const inspect = (value) => {
    if (!value || typeof value !== "object") return;
    if (
      !interaction &&
      typeof value.getActiveTool === "function" &&
      typeof value.wouldClaimTouch === "function"
    ) {
      interaction = value;
    }
    if (
      !selection &&
      typeof value.isLoaded === "function" &&
      typeof value.isOverText === "function"
    ) {
      selection = value;
    }
  };
  while (stack.length && (!interaction || !selection)) {
    const fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    // Walk hook chains and context values.
    let hook = fiber.memoizedState;
    let guard = 0;
    while (hook && guard++ < 200) {
      inspect(hook.memoizedState);
      inspect(hook.memoizedState?.value);
      inspect(hook.memoizedState?.current);
      if (hook.memoizedState?.memoizedState) inspect(hook.memoizedState.memoizedState);
      hook = hook.next;
    }
    inspect(fiber.memoizedProps);
    inspect(fiber.memoizedProps?.value);
    inspect(fiber.memoizedProps?.value?.current);
    inspect(fiber.stateNode);
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  const stage = window.__stage;
  const viewportRect = document.querySelector(".viewport").getBoundingClientRect();
  const pageBox = document.querySelector('.page[data-page-index="0"]').getBoundingClientRect();
  const scale = pageBox.width / 300;
  const blankViewport = {
    x: pageBox.x + 150 * scale - viewportRect.left,
    y: pageBox.y + 300 * scale - viewportRect.top,
  };
  const textViewport = {
    x: pageBox.x + 90 * scale - viewportRect.left,
    y: pageBox.y + 94 * scale - viewportRect.top,
  };
  const blankPage = stage.getPageAt(blankViewport);
  const textPage = stage.getPageAt(textViewport);
  const result = {
    foundInteraction: Boolean(interaction),
    foundSelection: Boolean(selection),
    activeTool: interaction
      ? {
          id: interaction.getActiveTool().id,
          touch: interaction.getActiveTool().touch ?? null,
          enables: [...interaction.getActiveTool().enables],
          activeToolId: interaction.getActiveToolId(),
          tools: interaction.listTools().map((tool) => tool.id),
        }
      : null,
    blankPage,
    textPage,
    blankPoint: blankPage ? stage.viewportToPage(blankPage.ref, blankViewport) : null,
    textPoint: textPage ? stage.viewportToPage(textPage.ref, textViewport) : null,
  };
  if (selection && blankPage) {
    result.blankLoaded = selection.isLoaded(blankPage.ref);
    result.blankOverText = selection.isOverText(
      blankPage.ref,
      result.blankPoint,
    );
  }
  if (selection && textPage) {
    result.textLoaded = selection.isLoaded(textPage.ref);
    result.textOverText = selection.isOverText(textPage.ref, result.textPoint);
  }
  if (interaction && blankPage) {
    const sample = {
      phase: "down",
      viewport: blankViewport,
      page: { ref: blankPage.ref, point: result.blankPoint },
      pointerType: "touch",
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      clickCount: 1,
    };
    result.wouldClaimTouch = interaction.wouldClaimTouch(sample);
  }
  // Keep capabilities for later calls in this page.
  window.__caps = { interaction, selection };
  window.__coords = { blankViewport, textViewport, blankPage, textPage };
  return result;
});
console.log("CAPS", JSON.stringify(caps, null, 2));

// Hover to load geometry, then re-check.
const box = await page.locator('.page[data-page-index="0"]').boundingBox();
const scale = box.width / 300;
await page.mouse.move(box.x + 90 * scale, box.y + 94 * scale);
await page.waitForTimeout(500);
console.log(
  "AFTER HOVER",
  JSON.stringify(
    await page.evaluate(() => {
      const { selection } = window.__caps;
      const { blankPage, blankViewport, textPage, textViewport } = window.__coords;
      const stage = window.__stage;
      return {
        blankLoaded: selection.isLoaded(blankPage.ref),
        blankOverText: selection.isOverText(
          blankPage.ref,
          stage.viewportToPage(blankPage.ref, blankViewport),
        ),
        textLoaded: selection.isLoaded(textPage.ref),
        textOverText: selection.isOverText(
          textPage.ref,
          stage.viewportToPage(textPage.ref, textViewport),
        ),
        cursor: getComputedStyle(
          document.elementFromPoint(
            document.querySelector(".viewport").getBoundingClientRect().left + textViewport.x,
            document.querySelector(".viewport").getBoundingClientRect().top + textViewport.y,
          ),
        ).cursor,
      };
    }),
  ),
);

// Mouse blank drag up.
await page.mouse.move(box.x + 150 * scale, box.y + 300 * scale);
await page.mouse.down();
await page.mouse.move(box.x + 150 * scale, box.y + 300 * scale - 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);
console.log(
  "DRAG RESULT",
  JSON.stringify({
    indexes: await page
      .locator(".page")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.pageIndex))),
    view: await page.evaluate(() =>
      window.__messages.filter((m) => m.patch?.view).at(-1)?.patch?.view,
    ),
  }),
);
await browser.close();
