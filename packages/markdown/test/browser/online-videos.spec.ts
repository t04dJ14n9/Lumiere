import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { open } from "./harness";

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
// A 1×1 PNG, so no test reaches the real providers.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function stubProviders(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(
    /^https:\/\/(i\.ytimg\.com|[^/]*youtube[^/]*)\//,
    (route) => {
      const url = route.request().url();
      requests.push(url);
      return url.startsWith("https://i.ytimg.com/")
        ? route.fulfill({ contentType: "image/png", body: PIXEL })
        : route.fulfill({
            contentType: "text/html",
            body: "<p>player stub</p>",
          });
    },
  );
  return requests;
}

test("a YouTube link becomes a card that opens the video in the browser", async ({
  page,
}) => {
  const requests = await stubProviders(page);
  await open(
    page,
    `Intro\n\n![Never gonna](${YOUTUBE}&t=42)\n\nAfter`,
    "obsidian",
    {
      trusted: true,
    },
  );
  const card = page.locator(".cm-content .mw-video");
  await expect(card).toHaveAttribute("data-provider", "youtube");
  await expect(card.locator(".mw-video-title")).toHaveText("Never gonna");
  await expect(card.locator(".mw-video-meta")).toHaveText(
    "YouTube · dQw4w9WgXcQ",
  );
  await expect(card.locator(".mw-video-thumb img")).toHaveAttribute(
    "src",
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  await expect(page.locator("iframe")).toHaveCount(0);
  // Buttons, since VS Code's webview would also open a clicked <a href>.
  await expect(card.locator("a")).toHaveCount(0);
  await card.getByRole("button", { name: "Open on YouTube" }).click();
  await card
    .getByRole("button", { name: "Open Never gonna on YouTube" })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.harness.opened))
    .toEqual([`${YOUTUBE}&t=42s`, `${YOUTUBE}&t=42s`]);
  expect(requests.every((url) => url.startsWith("https://i.ytimg.com/"))).toBe(
    true,
  );
});

test("the caret on a video link reveals its Markdown, like an image", async ({
  page,
}) => {
  await stubProviders(page);
  const source = `Intro\n\n![](https://youtu.be/dQw4w9WgXcQ)\n\nAfter`;
  await open(page, source, "obsidian", { trusted: true });
  await expect(page.locator(".cm-content .mw-video")).toHaveCount(1);
  await expect(page.locator(".mw-video-title")).toHaveText("YouTube video");
  await page.evaluate((at) => window.harness.reveal(at), source.indexOf("!["));
  await expect(page.locator(".cm-content .mw-video")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(
    "![](https://youtu.be/dQw4w9WgXcQ)",
  );
  await page.evaluate(() => window.harness.reveal(0));
  await expect(page.locator(".cm-content .mw-video")).toHaveCount(1);
});

test("an untrusted workspace shows a card with no cover or remote image", async ({
  page,
}) => {
  const requests = await stubProviders(page);
  await open(
    page,
    `Intro\n\n![Talk](${YOUTUBE})\n\n![](https://www.bilibili.com/video/BV1DRHU6LELy)\n\n![](https://example.com/photo.png)`,
    "obsidian",
  );
  const cards = page.locator(".cm-content .mw-video");
  await expect(cards).toHaveCount(1);
  await expect(cards.locator("img")).toHaveCount(0);
  await expect(cards.locator(".mw-video-note")).toContainText(
    "untrusted workspace",
  );
  await cards.getByRole("button", { name: "Open on YouTube" }).click();
  await expect
    .poll(() => page.evaluate(() => window.harness.opened))
    .toEqual([YOUTUBE]);
  // A removed provider's link is an ordinary remote image, as are others.
  await expect(page.locator(".cm-content img.note-image")).toHaveCount(2);
  expect(requests).toEqual([]);
});
