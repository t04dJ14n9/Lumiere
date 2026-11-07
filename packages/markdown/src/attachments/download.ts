/**
 * Obsidian's Download attachments for current file, its pure half: which
 * images a note shows from the web, the names they are saved under, and
 * their embeds once saved. Behaviour read from Obsidian 1.15.0's app.js
 * with REA (2026-11-07).
 */
import { metadata } from "../markdown/metadata";

/** A Markdown image whose source is on the web or in a data URI. */
export interface RemoteImage {
  readonly url: string;
  readonly alt: string;
  /** Where `![alt](url)` is in the note's text. */
  readonly from: number;
  readonly to: number;
}

const REMOTE = /^(?:https?:\/\/|data:)/iu;

/**
 * The note's Markdown images (`![alt](url)`) whose URL is `http(s):` or
 * `data:`, in reading order; images in code are not images. Wikilink embeds
 * name vault files and are never downloaded.
 */
export function remoteImages(text: string): RemoteImage[] {
  const images: RemoteImage[] = [];
  for (const embed of metadata(text).embeds) {
    const alt = /^!\[(.*?)\]\(/su.exec(embed.original)?.[1];
    if (alt === undefined || !REMOTE.test(embed.link)) {
      continue;
    }
    images.push({
      url: embed.link,
      alt,
      from: embed.position.start.offset,
      to: embed.position.end.offset,
    });
  }
  return images;
}

/** What Obsidian takes out of a name, and what Windows refuses in one. */
const UNSAFE_NAME = /[:#|^\\\r\n/*?"<>]|%%|\[\[|\]\]/gu;

/**
 * The stem a downloaded image is saved under: the file name at the end of
 * its URL when that has an extension (`photo.png` gives `photo`), otherwise
 * `Image`, as Obsidian names a data URI or `/avatar?id=1`.
 */
export function downloadStem(url: string): string {
  if (/^data:/iu.test(url)) {
    return "Image";
  }
  let name: string;
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    name = last ? decodeURIComponent(last) : "";
  } catch {
    return "Image";
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || !/^[a-z0-9]+$/iu.test(name.slice(dot + 1))) {
    return "Image";
  }
  const stem = name
    .slice(0, dot)
    .replace(UNSAFE_NAME, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 250);
  return stem || "Image";
}

/**
 * Edits replacing each downloaded image with its embed; `embedFor` gives
 * the embed for an image's URL and alt text, or undefined when that URL
 * was not saved. Images are found again in `text`, which may have changed
 * while they were downloading.
 */
export function withDownloadedImages(
  text: string,
  embedFor: (url: string, alt: string) => string | undefined,
): { from: number; to: number; insert: string }[] {
  const edits: { from: number; to: number; insert: string }[] = [];
  for (const image of remoteImages(text)) {
    const insert = embedFor(image.url, image.alt);
    if (insert !== undefined) {
      edits.push({ from: image.from, to: image.to, insert });
    }
  }
  return edits;
}
