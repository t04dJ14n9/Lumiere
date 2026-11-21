/**
 * Recognise the tweet links Obsidian 1.15.0 embeds when they are written as
 * images (`![](url)`). Only a fully parsed and validated ID leaves this
 * module; the frame and the card are built from it, never from the link text.
 *
 * Obsidian's own pattern is looser: it takes any path and the last number in
 * it, so a `/photo/1` link embeds tweet 1. Here an ID is taken only from the
 * shapes below and must be well formed, so other links stay ordinary images.
 */

export interface Tweet {
  /** A numeric tweet ID of at most 19 digits. */
  readonly id: string;
  /** The tweet's page, opened in the external browser. */
  readonly page: string;
}

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

export function parseTweet(raw: string): Tweet | undefined {
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
    url.port ||
    !TWEET_HOSTS.has(url.hostname)
  ) {
    return undefined;
  }
  const id = TWEET_PATH.exec(url.pathname)?.[1];
  // `x.com/i/status/ID` reaches the tweet whoever posted it.
  return id ? { id, page: `https://x.com/i/status/${id}` } : undefined;
}
