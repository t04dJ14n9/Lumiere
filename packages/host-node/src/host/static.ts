/** Files served as they are: the built editor, the page shim, a note's images. */
import type { Stats } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { vaultFileHeaders } from "../vault-file-headers";
import { isFilesystemRoot } from "./paths";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
};

/**
 * Whose file a response carries: the editor's own (its built files, the
 * shim), or a vault's, which is someone else's content on the embedder's
 * origin and must never run there (vault-file-headers.ts).
 */
export type FileSource = "editor" | "vault";

/** The request headers a file's response depends on. */
export type FileRequestHeaders = Pick<
  IncomingHttpHeaders,
  "range" | "if-none-match"
>;

/**
 * esbuild's chunk names (`chunk-<hash>.js`, `[name]-<hash>`): eight upper-case
 * letters and digits from the chunk's contents, so one name never changes.
 */
const CONTENT_HASHED = /-[A-Z0-9]{8}\.(?:js|css|wasm)$/;

/** A file under `base`, named by a URL path segment; 403 for anything outside it. */
export async function serveStatic(
  res: ServerResponse,
  base: string,
  relative: string,
  request: FileRequestHeaders = {},
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const root = path.resolve(base);
  const file = path.resolve(root, decoded);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  // A symlink inside the tree can still name a file outside it. Resolve both
  // sides and open only the canonical path, so the requested link cannot be
  // swapped after the check. A path that does not resolve is refused here:
  // opening its lexical name could follow a link planted after `realpath`.
  // A bundle root that resolves to the filesystem root makes every file look
  // contained.
  const rootReal = await realpath(root).catch(() => undefined);
  if (!rootReal || isFilesystemRoot(rootReal)) {
    res.writeHead(403).end();
    return;
  }
  const fileReal = await realpath(file).catch(() => undefined);
  if (!fileReal) {
    res.writeHead(404).end();
    return;
  }
  const relativeReal = path.relative(rootReal, fileReal);
  if (
    relativeReal === ".." ||
    relativeReal.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeReal)
  ) {
    res.writeHead(403).end();
    return;
  }
  await serveFile(res, fileReal, request);
}

/**
 * The one byte range `header` asks for in a file of `size` bytes; undefined
 * when the header is ignored, "unsatisfiable" when it is 416. A server MUST
 * ignore an unknown range unit and MAY ignore a malformed or multiple range;
 * only a valid, unsatisfiable `bytes=` range is 416 (RFC 9110 14.2).
 */
export function byteRange(
  header: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) {
    return undefined;
  }
  const [, first, last] = match;
  // Decimal numerals may exceed a safe integer: Number gives Infinity, which
  // the comparisons and Math.min/Math.max clamp. Rejecting those as malformed
  // would be the integer-overflow parse error RFC 9110 14.1.2 forbids.
  if (!first) {
    const length = Number(last);
    return length === 0 || size === 0
      ? "unsatisfiable"
      : { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last ? Number(last) : size - 1;
  if (start >= size || end < start) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}

/**
 * A validator from the file's size and modification time: a page opened
 * again (each note is a new iframe that loads the editor anew) revalidates
 * the editor's files and gets 304 instead of their bytes.
 */
function entityTag(info: Stats): string {
  return `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
}

/** Whether `If-None-Match` names `tag` (weak comparison, RFC 9110 13.1.2). */
export function matchesTag(header: string | undefined, tag: string): boolean {
  if (!header) {
    return false;
  }
  const opaque = (item: string) => item.trim().replace(/^W\//, "");
  return header
    .split(",")
    .some((item) => item.trim() === "*" || opaque(item) === opaque(tag));
}

/**
 * The editor's content-hashed chunks never change under one name; anything
 * else is revalidated on each use.
 */
function cacheControl(name: string, source: FileSource): string {
  return source === "editor" && CONTENT_HASHED.test(path.basename(name))
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

export async function serveFile(
  res: ServerResponse,
  file: string | URL,
  request: FileRequestHeaders = {},
  source: FileSource = "editor",
): Promise<void> {
  // stat before open: opening a FIFO would block until something writes to it.
  const info = await stat(file).catch(() => undefined);
  const handle = info?.isFile()
    ? await open(file, "r").catch(() => undefined)
    : undefined;
  if (!info || !handle) {
    res.writeHead(404).end();
    return;
  }
  const name = typeof file === "string" ? file : file.pathname;
  const tag = entityTag(info);
  const cache = { "cache-control": cacheControl(name, source), etag: tag };
  if (matchesTag(request["if-none-match"], tag)) {
    await handle.close().catch(() => undefined);
    res.writeHead(304, cache).end();
    return;
  }
  await sendContents(res, handle, {
    headers: { ...typeHeaders(name, source), ...cache },
    size: info.size,
    range: request.range,
  });
}

function typeHeaders(name: string, source: FileSource): Record<string, string> {
  if (source === "vault") {
    return { ...vaultFileHeaders(name), "accept-ranges": "bytes" };
  }
  return {
    "content-type":
      CONTENT_TYPES[path.extname(name).toLowerCase()] ??
      "application/octet-stream",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
}

interface Contents {
  readonly headers: Record<string, string>;
  readonly size: number;
  /** The request's Range header. */
  readonly range: string | undefined;
}

/** The whole file, or the one range the request asks for. */
async function sendContents(
  res: ServerResponse,
  handle: FileHandle,
  { headers, size, range: rangeHeader }: Contents,
): Promise<void> {
  const range = byteRange(rangeHeader ?? "", size);
  if (range === "unsatisfiable") {
    await handle.close().catch(() => undefined);
    res
      .writeHead(416, {
        ...headers,
        "content-range": `bytes */${size}`,
      })
      .end();
    return;
  }
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "content-length": range ? range.end - range.start + 1 : size,
    ...(range
      ? { "content-range": `bytes ${range.start}-${range.end}/${size}` }
      : {}),
  });
  // An unhandled stream error would end the whole server; pipeline destroys
  // the response instead, and closes the file when the client goes away.
  const stream = range
    ? handle.createReadStream({ start: range.start, end: range.end })
    : handle.createReadStream();
  await pipeline(stream, res).catch(() => undefined);
}
