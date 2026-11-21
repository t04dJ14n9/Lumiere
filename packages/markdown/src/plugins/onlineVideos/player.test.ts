import test from "node:test";
import assert from "node:assert/strict";
import { parseWebEmbed } from "./parse";
import type { WebEmbed } from "./parse";
import {
  PLAYER_SANDBOX,
  TWEET_DEFAULT_HEIGHT,
  TWEET_MAX_HEIGHT,
  TWEET_MIN_HEIGHT,
  TWEET_SANDBOX,
  clampTweetHeight,
  embedTheme,
  embedUrl,
  embedView,
  isEmbedUrl,
  reservedHeight,
} from "./player";

const embed = (link: string): WebEmbed => {
  const parsed = parseWebEmbed(link);
  assert.ok(parsed, link);
  return parsed;
};
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TWEET = "https://twitter.com/jack/status/1590000000000000000";

test("a YouTube frame is the nocookie player with the parsed ID and start", () => {
  assert.equal(
    embedUrl(embed(YOUTUBE), "light"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  assert.equal(
    embedUrl(embed(`${YOUTUBE}&t=1m2s`), "dark"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=62",
  );
  assert.equal(
    embedUrl(embed("https://youtu.be/dQw4w9WgXcQ?t=42"), "dark"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42",
  );
});

test("a tweet frame is the platform widget with the parsed ID and the theme", () => {
  assert.equal(
    embedUrl(embed(TWEET), "light"),
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=1590000000000000000",
  );
  assert.equal(
    embedUrl(embed("https://x.com/i/status/20"), "dark"),
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=dark&id=20",
  );
});

test("a YouTube frame is sandboxed to scripts, same origin and presentation", () => {
  const view = embedView(embed(YOUTUBE), { isTrusted: true, theme: "light" });
  assert.equal(view.kind, "frame");
  const { attributes } = view as Extract<typeof view, { kind: "frame" }>;
  assert.equal(attributes.sandbox, PLAYER_SANDBOX);
  assert.deepEqual(attributes.sandbox!.split(" ").sort(), [
    "allow-presentation",
    "allow-same-origin",
    "allow-scripts",
  ]);
  assert.equal(attributes.referrerpolicy, "strict-origin-when-cross-origin");
  assert.equal(attributes.loading, "lazy");
  assert.equal(attributes.title, "YouTube video dQw4w9WgXcQ");
  assert.equal(attributes.scrolling, undefined);
  // `allow` carries fullscreen; the legacy attribute beside it only warns.
  assert.match(attributes.allow!, /^fullscreen;/);
  assert.equal(attributes.allowfullscreen, undefined);
  assert.ok(isEmbedUrl(attributes.src!));
});

test("a tweet frame adds only popups to the player sandbox, and no scrolling", () => {
  const view = embedView(embed(TWEET), { isTrusted: true, theme: "dark" });
  assert.equal(view.kind, "frame");
  const { attributes } = view as Extract<typeof view, { kind: "frame" }>;
  assert.equal(attributes.sandbox, TWEET_SANDBOX);
  assert.deepEqual(
    TWEET_SANDBOX.split(" ").filter((flag) => !PLAYER_SANDBOX.includes(flag)),
    ["allow-popups", "allow-popups-to-escape-sandbox"],
  );
  assert.equal(attributes.scrolling, "no");
  assert.equal(attributes.referrerpolicy, "strict-origin-when-cross-origin");
  assert.equal(attributes.loading, "lazy");
  assert.equal(attributes.allow, "fullscreen");
  assert.match(attributes.src!, /theme=dark/);
  assert.ok(isEmbedUrl(attributes.src!));
});

test("no sandbox grants forms, modals, top navigation or downloads", () => {
  for (const sandbox of [PLAYER_SANDBOX, TWEET_SANDBOX]) {
    assert.doesNotMatch(
      sandbox,
      /allow-(top-navigation|forms|modals|downloads|pointer-lock|orientation-lock)/,
    );
  }
  assert.doesNotMatch(PLAYER_SANDBOX, /allow-popups/);
});

test("Restricted Mode gets a link card and no frame for either embed", () => {
  for (const link of [YOUTUBE, TWEET]) {
    for (const theme of ["light", "dark"] as const) {
      assert.deepEqual(embedView(embed(link), { isTrusted: false, theme }), {
        kind: "link-card",
      });
    }
  }
});

test("the allowlist accepts only the two frame shapes", () => {
  for (const href of [
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://platform.twitter.com/embed/Tweet.html?id=20&theme=dark&dnt=true",
  ]) {
    assert.equal(isEmbedUrl(href), true, href);
  }
  for (const href of [
    // Other hosts and look-alikes.
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com.evil.test/embed/dQw4w9WgXcQ",
    "https://platform.twitter.com.evil.test/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://syndication.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    // Scheme, credentials, port, fragment.
    "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "http://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
    "https://user@www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com:8443/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ#x",
    // Paths.
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ/../../evil",
    "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/short",
    "https://www.youtube-nocookie.com/embed/videoseries?list=PL4cUxeGkcC9gZD-Tvwfod2gaISzfRiP9d",
    "https://platform.twitter.com/widgets.js",
    "https://platform.twitter.com/embed/Tweet.html/x?dnt=true&theme=light&id=20",
    // Queries.
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=abc",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=1&start=2",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light",
    "https://platform.twitter.com/embed/Tweet.html?dnt=false&theme=light&id=20",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=blue&id=20",
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=x",
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
  const sneaky = embed(
    `https://twitter.com/jack/status/20?x=%22%3E%3Cscript%3E&theme=dark`,
  );
  assert.equal(
    embedUrl(sneaky, "light"),
    "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=light&id=20",
  );
  const sneakyVideo = embed(`${YOUTUBE}&autoplay=1&rel=1&origin=https://evil`);
  assert.equal(
    embedUrl(sneakyVideo, "light"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
});

test("heights are reserved before the frame is measured", () => {
  assert.equal(reservedHeight(embed(YOUTUBE)), 315);
  assert.equal(reservedHeight(embed(TWEET)), TWEET_DEFAULT_HEIGHT);
});

test("a tweet's height is clamped", () => {
  assert.equal(clampTweetHeight(400), 400);
  assert.equal(clampTweetHeight(400.6), 401);
  assert.equal(clampTweetHeight(5), TWEET_MIN_HEIGHT);
  assert.equal(clampTweetHeight(-1), TWEET_MIN_HEIGHT);
  assert.equal(clampTweetHeight(1e9), TWEET_MAX_HEIGHT);
  assert.equal(TWEET_MAX_HEIGHT, 1000);
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
