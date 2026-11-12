/** Files served as they are: the built editor, the page shim, a note's images. */
import { open, realpath, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
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

/** A file under `base`, named by a URL path segment; 403 for anything outside it. */
export async function serveStatic(
  res: ServerResponse,
  base: string,
  relative: string,
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
  await serveFile(res, fileReal);
}

export async function serveFile(
  res: ServerResponse,
  file: string | URL,
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
  res.writeHead(200, {
    "content-type":
      CONTENT_TYPES[path.extname(name).toLowerCase()] ??
      "application/octet-stream",
    "content-length": info.size,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  // An unhandled stream error would end the whole server; pipeline destroys
  // the response instead, and closes the file when the client goes away.
  await pipeline(handle.createReadStream(), res).catch(() => undefined);
}
