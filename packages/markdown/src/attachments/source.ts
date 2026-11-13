/**
 * Load attachment bytes from a remote or file URL on the host (webview CSP
 * blocks connect-src https, so downloads cannot happen in the page).
 */

import { mediaKind } from "../shared/media-kinds";
import { extensionForMime, extensionFromUrl } from "./html-images";
import { sniffImageExtension } from "./image-sniff";

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

/** What loading a source came to: bytes, a response that is no image, or nothing. */
export type SourceOutcome =
  | { readonly kind: "loaded"; readonly source: SourceBytes }
  | { readonly kind: "notImage" }
  | { readonly kind: "failed" };

const FAILED: SourceOutcome = { kind: "failed" };
const NOT_IMAGE: SourceOutcome = { kind: "notImage" };

/**
 * Download http(s) or read file:// into bytes + extension. Undefined on
 * failure, and, with `imagesOnly`, when what comes back is no image.
 */
export async function loadAttachmentSource(
  url: string,
  options: SourceOptions,
): Promise<SourceBytes | undefined> {
  const outcome = await loadAttachmentOutcome(url, options);
  return outcome.kind === "loaded" ? outcome.source : undefined;
}

/**
 * Like `loadAttachmentSource`, but tells a response that is no image (a
 * page, JSON) from one that could not be fetched, so a caller can say which.
 */
export async function loadAttachmentOutcome(
  url: string,
  options: SourceOptions,
): Promise<SourceOutcome> {
  const trimmed = url.trim();
  if (!isHostSourceUrl(trimmed)) {
    return FAILED;
  }
  try {
    return /^file:/i.test(trimmed)
      ? await readLocal(trimmed, options)
      : await download(trimmed, options);
  } catch {
    return FAILED;
  }
}

async function readLocal(
  url: string,
  options: SourceOptions,
): Promise<SourceOutcome> {
  const ext = extensionFromUrl(url);
  if (options.imagesOnly && !isImageUrl(url)) {
    return NOT_IMAGE;
  }
  const bytes = await options.readFile(url);
  return bytes && bytes.length > 0
    ? { kind: "loaded", source: { bytes, ext } }
    : FAILED;
}

/** Types a server sends for "I do not know": the bytes say what it is. */
const UNKNOWN_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-octet-stream",
]);

async function download(
  url: string,
  options: SourceOptions,
): Promise<SourceOutcome> {
  const response = await options.fetch(url);
  if (!response.ok) {
    return FAILED;
  }
  const mime = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  const isImageType = mime.startsWith("image/");
  if (options.imagesOnly && !isImageType && !UNKNOWN_TYPES.has(mime)) {
    return NOT_IMAGE;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return FAILED;
  }
  if (!options.imagesOnly) {
    return { kind: "loaded", source: { bytes, ext: extensionFromUrl(url) } };
  }
  const sniffed = isImageType ? undefined : sniffImageExtension(bytes);
  if (!isImageType && !sniffed) {
    return NOT_IMAGE;
  }
  // An image served from `/avatar.php` is kept as an image, not a `.php` file.
  const ext = isImageUrl(url)
    ? extensionFromUrl(url)
    : (sniffed ?? extensionForMime(mime));
  return { kind: "loaded", source: { bytes, ext } };
}

/** Whether the URL's path names an image file by its extension. */
function isImageUrl(url: string): boolean {
  try {
    return mediaKind(new URL(url).pathname) === "image";
  } catch {
    return false;
  }
}
