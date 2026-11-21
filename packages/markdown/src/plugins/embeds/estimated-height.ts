import { embedsImage } from "../../markdown/images";
import { mediaKind } from "../../shared/media-kinds";
import { TWEET_DEFAULT_HEIGHT, parseTweet } from "../onlineVideos/api";
import { embedsNote } from "./clicks";
import { writtenHeight, writtenWidth } from "./image-size";

/**
 * CodeMirror sizes a block widget from `estimatedHeight` until it measures
 * the widget, and again when a rebuilt decoration sits outside the viewport.
 * The default, -1, is one line (~24px). Image embeds are often a single source
 * line but hundreds of pixels tall (Obsidian `|W` / `|WxH` size, or natural
 * dimensions after load). Off-viewport rebuilds then collapse the height map
 * the same way tall Properties / tables do.
 *
 * Prefer an explicit `|WxH` height; otherwise reserve a stable default so
 * PageDown / click coordinates below the embed stay valid until measure runs.
 *
 * Tweet image links become a frame (Online Videos). Without a dedicated
 * reserve they fall through to CARD_DEFAULT (~64px).
 *
 * Note embeds are worse: the source is one line (`![[Other]]`) while resolved
 * content can be many paragraphs. A modest floor covers first paint; after
 * measure, remember the painted height so an off-viewport remount does not
 * fall back to the floor and jump every coordinate below the embed.
 */
const CHROME = 16;
/** Portrait / unknown images without `|WxH` — better than one line. */
const IMAGE_DEFAULT = 240;
/** `<video>` / `<audio>` controls chrome before metadata. */
const MEDIA_DEFAULT = 180;
/** PDF and other attachment cards. */
const CARD_DEFAULT = 48;
/** Embedded Obsidian Base (.base) table/cards/list view. */
const BASE_DEFAULT = 240;
/**
 * Note embeds: content unknown until resolve. 360 ≈ 15 body lines — enough
 * that a multi-paragraph remount rarely blanks PageDown before measure, and
 * short/missing notes shrink on first paint. Measured cache covers taller.
 */
const NOTE_DEFAULT = 360;

/** Painted heights for note embeds, keyed by Markdown source. */
const measuredNoteHeights = new Map<string, number>();

/** Remember a note embed's painted height for the next off-viewport remount. */
export function rememberNoteEmbedHeight(source: string, height: number): void {
  if (!embedsNote(source) || !(height > 0)) {
    return;
  }
  const previous = measuredNoteHeights.get(source) ?? 0;
  if (height > previous) {
    measuredNoteHeights.set(source, height);
  }
}

/** Test helper: drop remembered note-embed heights. */
export function clearNoteEmbedHeights(): void {
  measuredNoteHeights.clear();
}

function embedTarget(source: string): string {
  return (
    /^!\[\[([^\]|#^]*)/u.exec(source)?.[1] ??
    /^!\[[^\]]*\]\(\s*<?([^)>\s]*)/u.exec(source)?.[1] ??
    ""
  ).trim();
}

/** Reserve embed height from Markdown source before the DOM is measured. */
export function embedEstimatedHeight(source: string): number {
  if (!source) {
    return IMAGE_DEFAULT + CHROME;
  }
  if (embedsImage(source)) {
    const height = writtenHeight(source);
    if (height !== undefined) {
      return height + CHROME;
    }
    const width = writtenWidth(source);
    // Width-only size: Obsidian writes `|100` for display width; height waits
    // on natural aspect. Reserve at least the default, and not less than a
    // conservative square of that width capped so landscape stays modest.
    if (width !== undefined) {
      return (
        Math.max(IMAGE_DEFAULT, Math.min(width, IMAGE_DEFAULT * 2)) + CHROME
      );
    }
    return IMAGE_DEFAULT + CHROME;
  }
  if (embedsNote(source)) {
    const floor = NOTE_DEFAULT + CHROME;
    const cached = measuredNoteHeights.get(source);
    return cached === undefined ? floor : Math.max(floor, cached);
  }
  // Online Videos replaces a tweet's image URL with its frame; an untrusted
  // workspace's link card is shorter, and measure settles it.
  if (parseTweet(embedTarget(source))) {
    return TWEET_DEFAULT_HEIGHT + CHROME;
  }
  if (/\.base$/i.test(embedTarget(source))) {
    return BASE_DEFAULT + CHROME;
  }
  const kind = mediaKind(embedTarget(source));
  if (kind === "audio" || kind === "video") {
    return MEDIA_DEFAULT + CHROME;
  }
  return CARD_DEFAULT + CHROME;
}
