/**
 * Load attachment bytes from a remote or file URL on the host (webview CSP
 * blocks connect-src https, so downloads cannot happen in the page).
 */

import { mediaKind } from "../shared/media-kinds";
import { extensionForMime, extensionFromUrl } from "./html-images";

export interface SourceBytes {
  readonly bytes: Uint8Array;
  readonly ext: string;
}

export type SourceFetch = (url: string) => Promise<{
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type SourceRead = (uri: string) => Promise<Uint8Array | undefined>;

/** True when the webview should ask the host to load this URL (not a data URI). */
export function isHostSourceUrl(url: string): boolean {
  return /^(https?:|file:)/i.test(url.trim());
}

export interface SourceOptions {
  readonly fetch: SourceFetch;
  readonly readFile: SourceRead;
  /**
   * Load only images: a local file named as one, a download served or named
   * as one. Set when the URL comes from the untrusted page, which could
   * otherwise copy any file on the disk (`~/.ssh/id_rsa`) or any local
   * server's answer into the vault.
   */
  readonly imagesOnly?: boolean;
}

/**
 * Download http(s) or read file:// into bytes + extension. Undefined on failure.
 */
export async function loadAttachmentSource(
  url: string,
  options: SourceOptions,
): Promise<SourceBytes | undefined> {
  const trimmed = url.trim();
  if (!isHostSourceUrl(trimmed)) {
    return undefined;
  }
  try {
    return /^file:/i.test(trimmed)
      ? await readLocal(trimmed, options)
      : await download(trimmed, options);
  } catch {
    return undefined;
  }
}

async function readLocal(
  url: string,
  options: SourceOptions,
): Promise<SourceBytes | undefined> {
  const ext = extensionFromUrl(url);
  if (options.imagesOnly && !isImageUrl(url)) {
    return undefined;
  }
  const bytes = await options.readFile(url);
  return bytes && bytes.length > 0 ? { bytes, ext } : undefined;
}

async function download(
  url: string,
  options: SourceOptions,
): Promise<SourceBytes | undefined> {
  const response = await options.fetch(url);
  if (!response.ok) {
    return undefined;
  }
  const mime = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (options.imagesOnly && !mime.startsWith("image/") && !isImageUrl(url)) {
    return undefined;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return undefined;
  }
  // An image served from `/avatar.php` is kept as an image, not a `.php` file.
  const ext =
    options.imagesOnly && !isImageUrl(url)
      ? extensionForMime(mime)
      : extensionFromUrl(url);
  return { bytes, ext };
}

/** Whether the URL's path names an image file by its extension. */
function isImageUrl(url: string): boolean {
  try {
    return mediaKind(new URL(url).pathname) === "image";
  } catch {
    return false;
  }
}
