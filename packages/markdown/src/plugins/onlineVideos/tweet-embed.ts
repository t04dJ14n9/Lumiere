import type { Tweet } from "./parse";

/** The light or dark the tweet widget is drawn in, from the editor's theme. */
export type EmbedTheme = "light" | "dark";

/**
 * The theme of a VS Code webview, read from the classes VS Code puts on its
 * body: `vscode-dark` and `vscode-light`, and for the high-contrast themes
 * `vscode-high-contrast` (dark) and `vscode-high-contrast-light`. Obsidian
 * reads its own `theme-dark` class once, when the embed is made; so does this.
 */
export function embedTheme(classes: {
  contains(name: string): boolean;
}): EmbedTheme {
  const isDark =
    classes.contains("vscode-dark") ||
    (classes.contains("vscode-high-contrast") &&
      !classes.contains("vscode-high-contrast-light"));
  return isDark ? "dark" : "light";
}

/**
 * The only origin a frame may load. VS Code's webview CSP already admits
 * `https:` frames in a trusted workspace and none in an untrusted one
 * (`frame-src`, plugins/editor/webview-html.ts).
 */
export const TWEET_ORIGIN = "https://platform.twitter.com";
const TWEET_PATH = "/embed/Tweet.html";
const TWEET_ID = /^[1-9][0-9]{0,18}$/;

/**
 * The tweet widget runs its scripts and goes full screen. It is made of
 * links (the author, the tweet, a link card, its media), so it also needs
 * `allow-popups`; `allow-popups-to-escape-sandbox` lets the page that opens
 * run unsandboxed, as a page opened from a link would. It gets no
 * `allow-top-navigation`, `allow-forms` or `allow-modals`: it cannot send the
 * editor elsewhere.
 */
export const TWEET_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

/** The tweet widget is 550 px at its widest. */
export const TWEET_MAX_WIDTH = 550;
/** Where a frame starts, before its widget reports its own height. */
export const TWEET_DEFAULT_HEIGHT = 400;
export const TWEET_MIN_HEIGHT = 100;
/** The tallest a frame may be made, whatever its widget asks. */
export const TWEET_MAX_HEIGHT = 1000;

export function clampTweetHeight(height: number): number {
  return Math.min(
    TWEET_MAX_HEIGHT,
    Math.max(TWEET_MIN_HEIGHT, Math.round(height)),
  );
}

/** The frame's URL, from the parsed ID only (never the link text). */
export function embedUrl(tweet: Tweet, theme: EmbedTheme): string {
  const url = new URL(TWEET_PATH, TWEET_ORIGIN);
  url.searchParams.set("dnt", "true");
  url.searchParams.set("theme", theme);
  url.searchParams.set("id", tweet.id);
  return url.href;
}

/** True only for a URL `embedUrl` could have produced. */
export function isEmbedUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const query = url.searchParams;
  return (
    url.origin === TWEET_ORIGIN &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    url.pathname === TWEET_PATH &&
    [...query.keys()].sort().join() === "dnt,id,theme" &&
    query.get("dnt") === "true" &&
    (query.get("theme") === "light" || query.get("theme") === "dark") &&
    TWEET_ID.test(query.get("id") ?? "")
  );
}

/** What one tweet link shows. */
export type EmbedView =
  /** A frame with these attributes, as Obsidian draws it. */
  | { readonly kind: "frame"; readonly attributes: Record<string, string> }
  /** A static card with a button that opens the page; nothing is loaded. */
  | { readonly kind: "link-card" };

/**
 * Restricted Mode (an untrusted workspace) never gets a frame: the card
 * loads nothing from the site.
 */
export function embedView(
  tweet: Tweet,
  options: { isTrusted: boolean; theme: EmbedTheme },
): EmbedView {
  if (!options.isTrusted) {
    return { kind: "link-card" };
  }
  const src = embedUrl(tweet, options.theme);
  if (!isEmbedUrl(src)) {
    throw new Error(`Refusing embed URL ${src}`);
  }
  return {
    kind: "frame",
    attributes: {
      src,
      sandbox: TWEET_SANDBOX,
      allow: "fullscreen",
      referrerpolicy: "strict-origin-when-cross-origin",
      loading: "lazy",
      scrolling: "no",
      title: `Tweet ${tweet.id}`,
    },
  };
}
