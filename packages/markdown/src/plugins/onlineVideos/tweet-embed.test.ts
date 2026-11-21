import test from "node:test";
import assert from "node:assert/strict";
import { parseTweet } from "./parse";
import type { Tweet } from "./parse";
import {
  TWEET_DEFAULT_HEIGHT,
  TWEET_MAX_HEIGHT,
  TWEET_MIN_HEIGHT,
  TWEET_SANDBOX,
  clampTweetHeight,
  embedTheme,
  embedUrl,
  embedView,
  isEmbedUrl,
} from "./tweet-embed";

const tweet = (link: string): Tweet => {
  const parsed = parseTweet(link);
  assert.ok(parsed, link);
  return parsed;
};
const TWEET = "https://twitter.com/jack/status/1590000000000000000";

test("a tweet frame is the platform widget with the parsed ID and the theme", () => {
  assert.equal(
    embedUrl(tweet(TWEET), "light"),
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=1590000000000000000",
  );
  assert.equal(
    embedUrl(tweet("https://x.com/i/status/20"), "dark"),
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=dark&id=20",
  );
});

test("a tweet frame is sandboxed to scripts, same origin, presentation and popups", () => {
  const view = embedView(tweet(TWEET), { isTrusted: true, theme: "dark" });
  assert.equal(view.kind, "frame");
  const { attributes } = view as Extract<typeof view, { kind: "frame" }>;
  assert.equal(attributes.sandbox, TWEET_SANDBOX);
  assert.deepEqual(attributes.sandbox!.split(" ").sort(), [
    "allow-popups",
    "allow-popups-to-escape-sandbox",
    "allow-presentation",
    "allow-same-origin",
    "allow-scripts",
  ]);
  assert.equal(attributes.scrolling, "no");
  assert.equal(attributes.referrerpolicy, "strict-origin-when-cross-origin");
  assert.equal(attributes.loading, "lazy");
  assert.equal(attributes.allow, "fullscreen");
  assert.equal(attributes.title, "Tweet 1590000000000000000");
  assert.match(attributes.src!, /theme=dark/);
  assert.ok(isEmbedUrl(attributes.src!));
});

test("the sandbox grants no forms, modals, top navigation or downloads", () => {
  assert.doesNotMatch(
    TWEET_SANDBOX,
    /allow-(top-navigation|forms|modals|downloads|pointer-lock|orientation-lock)/,
  );
});

test("Restricted Mode gets a link card and no frame", () => {
  for (const theme of ["light", "dark"] as const) {
    assert.deepEqual(embedView(tweet(TWEET), { isTrusted: false, theme }), {
      kind: "link-card",
    });
  }
});

test("the allowlist accepts only the tweet widget's shape", () => {
  for (const href of [
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://platform.twitter.com/embed/Tweet.html?id=20&theme=dark&dnt=true",
  ]) {
    assert.equal(isEmbedUrl(href), true, href);
  }
  for (const href of [
    // Other hosts and look-alikes, and every YouTube address.
    "https://platform.twitter.com.evil.test/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://syndication.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    // Scheme, credentials, port, fragment.
    "http://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://user@platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://platform.twitter.com:8443/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20#x",
    // Paths.
    "https://platform.twitter.com/widgets.js",
    "https://platform.twitter.com/embed/Tweet.html/x?dnt=true&theme=light&id=20",
    "https://platform.twitter.com/embed/../Tweet.html?dnt=true&theme=light&id=20",
    // Queries.
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light",
    "https://platform.twitter.com/embed/Tweet.html",
    "https://platform.twitter.com/embed/Tweet.html?dnt=false&theme=light&id=20",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=blue&id=20",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=x",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=0",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20&extra=1",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20&id=21",
    "javascript:alert(1)",
    "data:text/html,x",
    "not a url",
    "",
  ]) {
    assert.equal(isEmbedUrl(href), false, href);
  }
});

test("a frame URL is built from the ID, never from the rest of the link", () => {
  const sneaky = tweet(
    "https://twitter.com/jack/status/20?x=%22%3E%3Cscript%3E&theme=dark",
  );
  assert.equal(
    embedUrl(sneaky, "light"),
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
  );
});

test("the theme comes from VS Code's body classes", () => {
  const theme = (...classes: string[]) =>
    embedTheme({ contains: (name) => classes.includes(name) });
  assert.equal(theme("vscode-dark"), "dark");
  assert.equal(theme("vscode-light"), "light");
  assert.equal(theme("vscode-high-contrast"), "dark");
  assert.equal(
    theme("vscode-high-contrast", "vscode-high-contrast-light"),
    "light",
  );
  assert.equal(theme("vscode-high-contrast-light"), "light");
  // Outside VS Code (a browser page with no theme classes): light.
  assert.equal(theme(), "light");
});

test("a tweet frame starts at a default height and is clamped", () => {
  assert.equal(TWEET_DEFAULT_HEIGHT, 400);
  assert.equal(clampTweetHeight(400), 400);
  assert.equal(clampTweetHeight(400.6), 401);
  assert.equal(clampTweetHeight(5), TWEET_MIN_HEIGHT);
  assert.equal(clampTweetHeight(-1), TWEET_MIN_HEIGHT);
  assert.equal(clampTweetHeight(1e9), TWEET_MAX_HEIGHT);
  assert.equal(TWEET_MAX_HEIGHT, 1000);
});
