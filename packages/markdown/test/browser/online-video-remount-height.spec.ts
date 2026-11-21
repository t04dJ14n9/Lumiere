/**
 * Tweet image links become tall frames. Without a reserved height they fell
 * through to PDF CARD_DEFAULT (~64px); off-viewport rebuilds then collapse the
 * height map like tall Properties.
 */
import { expect, test, type Page } from "@playwright/test";
import { open } from "./harness";

const TWEET = "https://x.com/jack/status/20";

function note(): string {
  const filler = Array.from(
    { length: 40 },
    (_, i) => `Filler paragraph ${i} scrolls the tweet away.`,
  ).join("\n\n");
  return `# Title\n\n![](${TWEET})\n\n${filler}\n`;
}

async function constrain(page: Page) {
  await page.addStyleTag({
    content:
      "#app, #app .cm-editor, #app .cm-scroller { height: 640px !important; max-height: 640px !important; } #app .cm-scroller { overflow: auto !important; }",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
}

async function stubWidget(page: Page) {
  await page.route(/^https:\/\/platform\.twitter\.com\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>tweet stub</p>" }),
  );
}

test("off-viewport tweet frame rebuild keeps its height in the map", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await stubWidget(page);
  await open(page, note(), "obsidian", { trusted: true });
  await constrain(page);
  await expect(page.locator(".cm-content .mw-embed").first()).toBeVisible({
    timeout: 10000,
  });

  const result = await page.evaluate(async () => {
    const fiber = [...window.harness.views[0]!.plugins].find(
      (plugin) => plugin.definition.name === "livePreview",
    );
    const view = fiber!.context!.editor.view;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const from = window.harness.text.indexOf("![](");
    const measured = view.lineBlockAt(from).height;
    const cardH = document
      .querySelector(".mw-embed")
      ?.getBoundingClientRect().height;
    window.harness.reveal(window.harness.text.indexOf("Filler paragraph 25"));
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const touchAt = from + 2;
    view.dispatch({ changes: { from: touchAt, to: touchAt, insert: "x" } });
    view.dispatch({ changes: { from: touchAt, to: touchAt + 1, insert: "" } });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return {
      measured,
      afterRebuild: view.lineBlockAt(from).height,
      cardH,
      inDom: !!document.querySelector(".mw-embed"),
    };
  });

  expect(result.measured, JSON.stringify(result)).toBeGreaterThan(80);
  expect(result.afterRebuild, JSON.stringify(result)).toBeGreaterThan(
    result.measured * 0.7,
  );
});
