import type { WebEmbed } from "./parse";

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
 * The only origins a frame may load. VS Code's webview CSP already admits
 * `https:` frames in a trusted workspace and none in an untrusted one
 * (`frame-src`, plugins/editor/webview-html.ts); these are the two this
 * plugin ever asks for.
 */
const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";
export const TWEET_ORIGIN = "https://platform.twitter.com";

const YOUTUBE_PATH = /^\/embed\/[A-Za-z0-9_-]{11}$/;
const TWEET_PATH = "/embed/Tweet.html";
const SECONDS = /^[1-9][0-9]{0,8}$/;
const TWEET_ID = /^[1-9][0-9]{0,18}$/;

/** A video player runs scripts and goes full screen; nothing else. */
export const PLAYER_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";
/**
 * A tweet is made of links (the author, the tweet, a link card, its media),
 * so it also needs `allow-popups`; `allow-popups-to-escape-sandbox` lets the
 * page that opens run unsandboxed, as a page opened from a link would. It
 * gets no `allow-top-navigation`: a tweet cannot send the editor elsewhere.
 */
export const TWEET_SANDBOX = `${PLAYER_SANDBOX} allow-popups allow-popups-to-escape-sandbox`;

/** A player is 16:9 and never wider than this (CSS `max-width`). */
export const YOUTUBE_MAX_WIDTH = 560;
/** The tweet widget is 550 px at its widest. */
export const TWEET_MAX_WIDTH = 550;
/** Where a tweet frame starts, before its widget reports its own height. */
export const TWEET_DEFAULT_HEIGHT = 400;
export const TWEET_MIN_HEIGHT = 100;
/** The tallest a tweet frame may be made, whatever its widget asks. */
export const TWEET_MAX_HEIGHT = 1000;

/** The height an embed takes before it is measured, in CSS pixels. */
export function reservedHeight(embed: WebEmbed): number {
  return embed.kind === "youtube"
    ? Math.round((YOUTUBE_MAX_WIDTH * 9) / 16)
    : TWEET_DEFAULT_HEIGHT;
}

export function clampTweetHeight(height: number): number {
  return Math.min(
    TWEET_MAX_HEIGHT,
    Math.max(TWEET_MIN_HEIGHT, Math.round(height)),
  );
}

/** The frame's URL, from the parsed ID only (never the link text). */
export function embedUrl(embed: WebEmbed, theme: EmbedTheme): string {
  if (embed.kind === "youtube") {
    const url = new URL(`/embed/${embed.id}`, YOUTUBE_ORIGIN);
    if (embed.start) {
      url.searchParams.set("start", String(embed.start));
    }
    return url.href;
  }
  const url = new URL(TWEET_PATH, TWEET_ORIGIN);
  url.searchParams.set("dnt", "true");
  url.searchParams.set("theme", theme);
  url.searchParams.set("id", embed.id);
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
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    return false;
  }
  if (url.origin === YOUTUBE_ORIGIN) {
    return YOUTUBE_PATH.test(url.pathname) && isYouTubeQuery(url.searchParams);
  }
  return (
    url.origin === TWEET_ORIGIN &&
    url.pathname === TWEET_PATH &&
    isTweetQuery(url.searchParams)
  );
}

function isYouTubeQuery(query: URLSearchParams): boolean {
  const keys = [...query.keys()];
  return (
    keys.length === 0 ||
    (keys.length === 1 && SECONDS.test(query.get("start") ?? ""))
  );
}

function isTweetQuery(query: URLSearchParams): boolean {
  const keys = [...query.keys()].sort();
  return (
    keys.join() === "dnt,id,theme" &&
    query.get("dnt") === "true" &&
    (query.get("theme") === "light" || query.get("theme") === "dark") &&
    TWEET_ID.test(query.get("id") ?? "")
  );
}

/** What one embed shows. */
export type EmbedView =
  /** A frame with these attributes, as Obsidian draws it. */
  | { readonly kind: "frame"; readonly attributes: Record<string, string> }
  /** A static card with a button that opens the page; nothing is loaded. */
  | { readonly kind: "link-card" };

/**
 * Restricted Mode (an untrusted workspace) never gets a frame: the card
 * loads nothing from either site.
 */
export function embedView(
  embed: WebEmbed,
  options: { isTrusted: boolean; theme: EmbedTheme },
): EmbedView {
  if (!options.isTrusted) {
    return { kind: "link-card" };
  }
  const src = embedUrl(embed, options.theme);
  if (!isEmbedUrl(src)) {
    throw new Error(`Refusing embed URL ${src}`);
  }
  const common = {
    src,
    referrerpolicy: "strict-origin-when-cross-origin",
    loading: "lazy",
  };
  if (embed.kind === "youtube") {
    return {
      kind: "frame",
      attributes: {
        ...common,
        sandbox: PLAYER_SANDBOX,
        allow: "fullscreen; picture-in-picture; encrypted-media",
        title: `YouTube video ${embed.id}`,
      },
    };
  }
  return {
    kind: "frame",
    attributes: {
      ...common,
      sandbox: TWEET_SANDBOX,
      allow: "fullscreen",
      scrolling: "no",
      title: `Tweet ${embed.id}`,
    },
  };
}
