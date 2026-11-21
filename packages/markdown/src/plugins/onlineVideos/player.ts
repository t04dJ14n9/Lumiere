import type { OnlineVideo } from "./parse";

/** The only origin a player frame may load, and the paths under it. */
const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";
const YOUTUBE_PATH = /^\/embed\/[A-Za-z0-9_-]{11}$/;

/** Player frames may run scripts and go full screen, nothing else. */
export const PLAYER_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";

export function playerUrl(video: OnlineVideo): string {
  const url = new URL(`/embed/${video.id}`, YOUTUBE_ORIGIN);
  url.searchParams.set("rel", "0");
  if (video.start) {
    url.searchParams.set("start", String(video.start));
  }
  return url.href;
}

/** True only for a URL `playerUrl` could have produced. */
export function isPlayerUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return (
    url.origin === YOUTUBE_ORIGIN &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    YOUTUBE_PATH.test(url.pathname)
  );
}

export function playerAttributes(video: OnlineVideo): Record<string, string> {
  const src = playerUrl(video);
  if (!isPlayerUrl(src)) {
    throw new Error(`Refusing player URL ${src}`);
  }
  return {
    src,
    sandbox: PLAYER_SANDBOX,
    allow: "fullscreen; picture-in-picture; encrypted-media",
    allowfullscreen: "",
    referrerpolicy: "strict-origin-when-cross-origin",
    loading: "lazy",
    title: `YouTube video ${video.id}`,
  };
}

/** YouTube's still for the video, derived from the ID alone. */
export function thumbnailUrl(video: OnlineVideo): string {
  return `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
}
