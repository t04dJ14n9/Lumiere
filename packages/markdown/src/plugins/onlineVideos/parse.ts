/**
 * Recognise YouTube video links. Only a fully parsed and validated ID leaves
 * this module; cards are built from it, never from the link text.
 */

export type VideoProvider = "youtube";
export type MediaKind = "video";
export interface OnlineVideo {
  readonly provider: VideoProvider;
  readonly kind: MediaKind;
  /** An 11-character YouTube video ID. */
  readonly id: string;
  /** YouTube start time in whole seconds. */
  readonly start?: number;
  /** The canonical page, opened in the external browser. */
  readonly page: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** `/embed/videoseries?list=…` is a playlist; the word is 11 characters long. */
const PLAYLIST_EMBED = "videoseries";
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_PATHS = /^\/(?:shorts|embed|live|v)\/([^/]+)\/?$/;
const MAX_INTEGER = 10 ** 9;

export function parseVideoUrl(raw: string): OnlineVideo | undefined {
  const url = httpUrl(raw);
  if (!url) {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    return youtubeVideo(/^\/([^/]+)\/?$/.exec(url.pathname)?.[1], url);
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : YOUTUBE_PATHS.exec(url.pathname)?.[1];
    return youtubeVideo(id ?? undefined, url);
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
): OnlineVideo | undefined {
  if (!id || !YOUTUBE_ID.test(id) || id === PLAYLIST_EMBED) {
    return undefined;
  }
  const start = seconds(
    url.searchParams.get("t") ?? url.searchParams.get("start"),
  );
  const page = `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;
  return start
    ? { provider: "youtube", kind: "video", id, start, page }
    : { provider: "youtube", kind: "video", id, page };
}

/** `90`, `90s`, `1m30s` or `1h2m3s`; anything else is ignored. */
function seconds(value: string | null): number | undefined {
  const match = value
    ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value)
    : undefined;
  if (!match || !value) {
    return undefined;
  }
  const [, h = "0", m = "0", s = "0"] = match;
  const total = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return total > 0 && total < MAX_INTEGER ? total : undefined;
}
