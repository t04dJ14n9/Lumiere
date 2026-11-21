import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { open } from "./harness";

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TWEET = "https://twitter.com/jack/status/1590000000000000000";

/**
 * Stands in for both sites, so no test reaches them. The tweet widget's
 * stand-in reports a height of 600 to its parent, as the real one does.
 */
async function stubSites(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(
    /^https:\/\/(www\.youtube-nocookie\.com|platform\.twitter\.com)\//,
    (route) => {
      const url = route.request().url();
      requests.push(url);
      const resize = JSON.stringify({
        "twttr.embed": {
          method: "twttr.private.resize",
          params: [{ width: 550, height: 600 }],
          jsonrpc: "2.0",
        },
      });
      return route.fulfill({
        contentType: "text/html",
        body: url.includes("twitter")
          ? `<p>tweet stub</p><script>parent.postMessage(${resize}, "*")</script>`
          : "<p>player stub</p>",
      });
    },
  );
  // Links to anything else are not embedded and fail as any non-image does.
  await page.route(/^https:\/\/(open\.spotify\.com|example\.com)\//, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  return requests;
}

test("a YouTube link becomes a sandboxed 16:9 player in a trusted workspace", async ({
  page,
}) => {
  const requests = await stubSites(page);
  await open(
    page,
    `Intro\n\n![Never gonna](${YOUTUBE}&t=42)\n\n![](https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl)\n\n![](https://example.com/page)\n\nAfter`,
    "obsidian",
    { trusted: true },
  );
  const frame = page.locator(".cm-content .mw-embed-youtube iframe");
  await expect(frame).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42",
  );
  await expect(frame).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-presentation",
  );
  await expect(frame).toHaveAttribute(
    "referrerpolicy",
    "strict-origin-when-cross-origin",
  );
  await expect(frame).toHaveAttribute("loading", "lazy");
  await expect(
    page.frameLocator(".mw-embed-youtube iframe").getByText("player stub"),
  ).toBeVisible();
  const box = (await frame.boundingBox())!;
  expect(box.height).toBeCloseTo((box.width * 9) / 16, 0);
  await expect(page.locator(".mw-embed-card")).toHaveCount(0);
  // A removed provider's link is as any unrecognised remote image: Embeds'.
  const unresolved = page.locator(".cm-content .unresolved-embed");
  await expect(unresolved).toHaveText([
    "failed to fetch image",
    "failed to fetch image",
  ]);
  expect(requests).toEqual([
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42",
  ]);
});

test("a tweet link becomes a frame that takes its widget's height, from its widget alone", async ({
  page,
}) => {
  const requests = await stubSites(page);
  await open(page, `Intro\n\n![](${TWEET}?s=20)\n\nAfter`, "obsidian", {
    trusted: true,
  });
  const frame = page.locator(".cm-content .mw-embed-tweet iframe");
  await expect(frame).toHaveAttribute(
    "src",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=1590000000000000000",
  );
  await expect(frame).toHaveAttribute("scrolling", "no");
  await expect(frame).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox",
  );
  await expect(
    page.frameLocator(".mw-embed-tweet iframe").getByText("tweet stub"),
  ).toBeVisible();
  await expect(frame).toHaveCSS("height", "600px");
  // The page's own message, or a forged one from another origin, changes nothing.
  await page.evaluate(() =>
    window.postMessage(
      {
        "twttr.embed": {
          method: "twttr.private.resize",
          params: [{ height: 900 }],
        },
      },
      "*",
    ),
  );
  await page.waitForTimeout(200);
  await expect(frame).toHaveCSS("height", "600px");
  expect(requests).toEqual([
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=1590000000000000000",
  ]);
});

test("the caret on an embed link reveals its Markdown, like an image", async ({
  page,
}) => {
  await stubSites(page);
  const source = `Intro\n\n![](https://youtu.be/dQw4w9WgXcQ)\n\nAfter`;
  await open(page, source, "obsidian", { trusted: true });
  await expect(page.locator(".cm-content .mw-embed iframe")).toHaveCount(1);
  await page.evaluate((at) => window.harness.reveal(at), source.indexOf("!["));
  await expect(page.locator(".cm-content .mw-embed")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(
    "![](https://youtu.be/dQw4w9WgXcQ)",
  );
  await page.evaluate(() => window.harness.reveal(0));
  await expect(page.locator(".cm-content .mw-embed iframe")).toHaveCount(1);
});

test("an untrusted workspace shows link cards and loads nothing", async ({
  page,
}) => {
  const requests = await stubSites(page);
  await open(
    page,
    `Intro\n\n![Talk](${YOUTUBE})\n\n![](${TWEET})\n\n![](https://www.bilibili.com/video/BV1DRHU6LELy)\n\n![](https://example.com/photo.png)`,
    "obsidian",
  );
  const cards = page.locator(".cm-content .mw-embed-card");
  await expect(cards).toHaveCount(2);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(cards.first().locator(".mw-embed-card-title")).toHaveText(
    "Talk",
  );
  await expect(cards.nth(1).locator(".mw-embed-card-title")).toHaveText(
    "Tweet",
  );
  await expect(cards.first().locator(".mw-embed-card-note")).toContainText(
    "untrusted workspace",
  );
  await cards.first().getByRole("button", { name: "Open on YouTube" }).click();
  await cards.nth(1).getByRole("button", { name: "Open on X" }).click();
  await expect
    .poll(() => page.evaluate(() => window.harness.opened))
    .toEqual([YOUTUBE, "https://x.com/i/status/1590000000000000000"]);
  // A removed provider's link is an ordinary remote image, as is any other.
  await expect(page.locator(".cm-content img.note-image")).toHaveCount(2);
  expect(requests).toEqual([]);
});
