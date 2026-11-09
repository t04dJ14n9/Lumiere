import { decodeBase64 } from "./base64";
/**
 * Find remote / data-URI Markdown images and rewrite each successful save to
 * a vault embed. Failed items keep their original markdown (no broken links).
 */

/** Markdown image whose destination is http(s) or a data URI. */
const REMOTE_IMAGE =
  /!\[([^\]]*)\]\((data:[^)\s]+|https?:[^)\s]+)(?:\s+"[^"]*")?\)/gi;

export interface ImageCandidate {
  readonly full: string;
  readonly alt: string;
  readonly src: string;
  readonly index: number;
}

/** Remote and data-URI images in Markdown produced by HTML paste. */
export function remoteImagesInMarkdown(markdown: string): ImageCandidate[] {
  const found: ImageCandidate[] = [];
  for (const match of markdown.matchAll(REMOTE_IMAGE)) {
    found.push({
      full: match[0]!,
      alt: match[1] ?? "",
      src: match[2]!,
      index: match.index ?? 0,
    });
  }
  return found;
}

/**
 * Replace each candidate with `embedFor(src)` when that returns a string;
 * leave the original markdown when it returns undefined (failed save).
 */
export async function rewriteRemoteImages(
  markdown: string,
  embedFor: (src: string) => Promise<string | undefined>,
): Promise<string> {
  const candidates = remoteImagesInMarkdown(markdown);
  if (candidates.length === 0) {
    return markdown;
  }
  const embeds = new Map<string, string | undefined>();
  for (const candidate of candidates) {
    if (!embeds.has(candidate.src)) {
      embeds.set(candidate.src, await embedFor(candidate.src));
    }
  }
  return markdown.replace(REMOTE_IMAGE, (full, _alt, src: string) => {
    return embeds.get(src) ?? full;
  });
}

/**
 * The bytes of a data URI payload without `;base64`: each `%XX` is one byte,
 * any other text, a stray `%` included, is taken as typed in UTF-8.
 */
function percentDecode(payload: string): Uint8Array {
  const encoder = new TextEncoder();
  const parts = payload
    .split(/(%[0-9a-f]{2})/i)
    .map((part, index) =>
      index % 2 === 1
        ? Uint8Array.of(parseInt(part.slice(1), 16))
        : encoder.encode(part),
    );
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** Decode a data URI, base64 or percent-encoded, into bytes and a file extension hint. */
export function decodeDataUri(
  src: string,
): { bytes: Uint8Array; ext: string } | undefined {
  const match = /^data:([^;,]+)?((?:;[^,]*)?),(.+)$/i.exec(src);
  if (!match) {
    return undefined;
  }
  const mime = (match[1] ?? "application/octet-stream").toLowerCase();
  const ext = extensionForMime(mime);
  const bytes = /;base64$/i.test(match[2]!)
    ? decodeBase64(match[3]!)
    : percentDecode(match[3]!);
  return bytes ? { bytes, ext } : undefined;
}

export function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif",
  };
  return map[mime] ?? "png";
}

/** Extension from a URL path, defaulting to png. */
export function extensionFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const name = path.split("/").pop() ?? "";
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      const ext = name.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{1,8}$/.test(ext)) {
        return ext;
      }
    }
  } catch {
    // not a URL
  }
  return "png";
}
