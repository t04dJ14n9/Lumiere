/**
 * Obsidian's Download attachments for current file, its pure half: which
 * images a note shows from the web, the names they are saved under, and
 * their embeds once saved. Behaviour read from Obsidian 1.15.0's app.js
 * with REA (2026-11-07).
 */
import { metadata } from "../markdown/metadata";
import {
  mapPropertyStrings,
  type PropertyChange,
} from "../markdown/properties";
import { mediaExtensions, mediaKind } from "../shared/media-kinds";
import { t } from "@workshop/l10n";

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

/** A stem without what breaks a link or a Windows name, in one line. */
function cleanStem(stem: string): string {
  return stem
    .replace(UNSAFE_NAME, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 250);
}

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
  return cleanStem(name.slice(0, dot)) || "Image";
}

/**
 * What a downloaded image is saved as. A name the server gave
 * (`Content-Disposition`) wins over the URL's: its image extension is kept,
 * and any other leaves the whole name as the stem under the download's own
 * extension, so a server cannot make us save a `.php`. A name with nothing
 * left after cleaning is ignored.
 */
export function downloadFileName(
  url: string,
  source: { readonly ext: string; readonly fileName?: string },
): { stem: string; ext: string } {
  const served = source.fileName ?? "";
  const dot = served.lastIndexOf(".");
  const ext = served.slice(dot + 1).toLowerCase();
  const hasImageExtension =
    dot >= 0 && (mediaExtensions.image as readonly string[]).includes(ext);
  const stem = cleanStem(hasImageExtension ? served.slice(0, dot) : served)
    // A name of dots has no stem, and Windows drops a trailing dot.
    .replace(/^[\s.]+|[\s.]+$/gu, "");
  if (!stem) {
    return { stem: downloadStem(url), ext: source.ext };
  }
  return { stem, ext: hasImageExtension ? ext : source.ext };
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

/** Whether a property's text is one web URL that names an image file. */
function isImageUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/iu.test(value)) {
    return false;
  }
  try {
    return mediaKind(new URL(value).pathname) === "image";
  } catch {
    return false;
  }
}

/**
 * The image URLs the note's properties hold, as a value or as a list item,
 * in reading order. A URL counts when its path ends in an image extension;
 * nothing is fetched to find out. (Obsidian asks more: the whole URL must end
 * in the extension, so `cat.png?w=2` is not taken there.)
 */
export function propertyImageUrls(text: string): string[] {
  const urls: string[] = [];
  mapPropertyStrings(text, (value) => {
    if (isImageUrl(value)) {
      urls.push(value);
    }
    return undefined;
  });
  return urls;
}

/**
 * Edits replacing each downloaded property image's URL with `linkFor(url)`,
 * where it stands in the header; undefined leaves that URL. Like
 * `withDownloadedImages`, it reads `text` as it is now.
 */
export function withDownloadedPropertyImages(
  text: string,
  linkFor: (url: string) => string | undefined,
): PropertyChange[] {
  return mapPropertyStrings(text, (value) =>
    isImageUrl(value) ? linkFor(value) : undefined,
  );
}

const cut = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length)}…` : text;

/**
 * What a checklist of downloads shows for an image URL: its name, where it
 * is from, and the URL itself. Cut short, since a data URI can be megabytes
 * and a host may refuse to show a row that long.
 */
export function imageChoice(url: string): {
  label: string;
  description: string;
  detail: string;
} {
  const data = /^data:([^;,]*)/iu.exec(url);
  if (data) {
    return {
      label: t("Embedded image"),
      description: data[1]!.toLowerCase(),
      detail: cut(url, 60),
    };
  }
  let host = "";
  let name = "";
  try {
    const parsed = new URL(url);
    host = parsed.host;
    const last = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
    name = decodeURIComponent(last);
  } catch {
    // An address that is not a URL, or an escape that is not UTF-8, keeps what it has.
  }
  return {
    label: cut(name || host || url, 80),
    description: host,
    detail: cut(url, 200),
  };
}
