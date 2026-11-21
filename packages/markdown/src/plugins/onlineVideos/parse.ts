/**
 * Recognise the two web links Obsidian 1.15.0 embeds when they are written
 * as images (`![](url)`): a YouTube video and a tweet. Only a fully parsed
 * and validated ID leaves this module; frames and cards are built from it,
 * never from the link text.
 *
 * Obsidian's own patterns are looser (its YouTube pattern takes the first
 * path word as the ID, so a Shorts or live link becomes the broken player
 * `/embed/shorts`; its tweet pattern takes the last number in the path, so a
 * `/photo/1` link embeds tweet 1). Here an ID is taken only from the shapes
 * below and must be well formed, so those links stay ordinary images.
 */

export interface YouTubeVideo {
  readonly kind: "youtube";
  /** An 11-character video ID. */
  readonly id: string;
  /** Start time in whole seconds. */
  readonly start?: number;
  /** The canonical page, opened in the external browser. */
  readonly page: string;
}
export interface Tweet {
  readonly kind: "tweet";
  /** A numeric tweet ID of at most 19 digits. */
  readonly id: string;
  readonly page: string;
}
export type WebEmbed = YouTubeVideo | Tweet;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** `/embed/videoseries?list=…` is a playlist; the word is 11 characters long. */
const PLAYLIST_EMBED = "videoseries";
/** The hosts Obsidian's pattern allows: an optional `www.` or `m.` only. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be", "m.youtu.be"]);
/** `/embed/ID` and `/v/ID`; `/watch?v=ID` is read from the query. */
const YOUTUBE_PATH = /^\/(?:embed|v)\/([^/]+)\/?$/;
const YOUTUBE_SHORT_PATH = /^\/([^/]+)\/?$/;

/** Obsidian's pattern allows `mobile.` and no `www.`. */
const TWEET_HOSTS = new Set([
  "twitter.com",
  "x.com",
  "mobile.twitter.com",
  "mobile.x.com",
]);
/**
 * `/{handle}/status/{id}` or `/i/web/status/{id}`, with the `/photo/N` or
 * `/video/N` a link to one of its media adds.
 */
const TWEET_PATH =
  /^\/(?:i\/web|[A-Za-z0-9_]{1,15})\/status\/([1-9][0-9]{0,18})(?:\/(?:photo|video)\/[1-9][0-9]?)?\/?$/;

const MAX_SECONDS = 10 ** 9;

export function parseWebEmbed(raw: string): WebEmbed | undefined {
  const url = httpUrl(raw);
  if (!url) {
    return undefined;
  }
  const host = url.hostname;
  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    return youtubeVideo(YOUTUBE_SHORT_PATH.exec(url.pathname)?.[1], url);
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : YOUTUBE_PATH.exec(url.pathname)?.[1];
    return youtubeVideo(id ?? undefined, url);
  }
  if (TWEET_HOSTS.has(host)) {
    return tweet(TWEET_PATH.exec(url.pathname)?.[1]);
  }
  return undefined;
}

function httpUrl(raw: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    return undefined;
  }
  return url;
}

function youtubeVideo(
  id: string | undefined,
  url: URL,
): YouTubeVideo | undefined {
  if (!id || !YOUTUBE_ID.test(id) || id === PLAYLIST_EMBED) {
    return undefined;
  }
  const start = seconds(
    url.searchParams.get("t") ?? url.searchParams.get("start"),
  );
  const page = `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;
  return start
    ? { kind: "youtube", id, start, page }
    : { kind: "youtube", id, page };
}

function tweet(id: string | undefined): Tweet | undefined {
  // `x.com/i/status/ID` reaches the tweet whoever posted it.
  return id
    ? { kind: "tweet", id, page: `https://x.com/i/status/${id}` }
    : undefined;
}

/**
 * `90`, `90s`, `1m30s` or `1h2m3s`; anything else is ignored. (Obsidian
 * reads only the digits, so it takes `1m30s` as one second.)
 */
function seconds(value: string | null): number | undefined {
  const match = value
    ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value)
    : undefined;
  if (!match || !value) {
    return undefined;
  }
  const [, h = "0", m = "0", s = "0"] = match;
  const total = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return total > 0 && total < MAX_SECONDS ? total : undefined;
}
