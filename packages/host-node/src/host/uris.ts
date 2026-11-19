/**
 * `file:` URIs as paths, for the shared host: joining a relative path onto a
 * folder (resolving `.` and `..` as `path.posix.join` does), a URI's folder,
 * and its name. The host compares URIs as strings, so they are built by the
 * platform (`HostFiles.uriOf`), exactly as its own runtime writes them.
 *
 * A Windows drive (`/C:/x`) is a root, as the URL standard makes it: `..`
 * never climbs above it, and the folder of `/C:/x` is `/C:/`. A bare `/C:`
 * would name the drive's current folder on Windows, not its root.
 */
import type { HostFiles } from "./platform";

/**
 * The URI of an absolute path with `/`, as Node 26's `pathToFileURL` writes
 * it: the URL standard's path encoding, plus `% \ [ ] | ~` and line breaks.
 * A platform without Node builds URIs with this.
 */
export function fileUri(path: string): string {
  const url = new URL("file:///");
  url.pathname = path.replace(
    /[%\\[\]|~\n\r\t]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
  return url.href;
}

/**
 * The decoded path of a `file:` URI, with `/` (`/C:/x` for a Windows drive).
 * Throws for another scheme, and for an encoded `/` or `\`, which would hide
 * a separator from a containment check (as Node's `fileURLToPath` does).
 */
export function uriPath(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== "file:" || /%2f|%5c/i.test(url.pathname)) {
    throw new TypeError(`Not a file path: ${uri}`);
  }
  // The URL parser has already resolved `.` and `..`, also encoded ones.
  return decodeURIComponent(url.pathname);
}

/** `relative` (with `/`) under `folder`; `..` may leave it, as with `path.join`. */
export function joinUri(
  files: Pick<HostFiles, "uriOf">,
  folder: string,
  relative: string,
): string {
  return files.uriOf(joinPaths(uriPath(folder), relative));
}

/** The folder `uri` is in. */
export function parentUri(
  files: Pick<HostFiles, "uriOf">,
  uri: string,
): string {
  return files.uriOf(joinPaths(uriPath(uri), ".."));
}

/** The last part of `uri`'s path, decoded. */
export function uriName(uri: string): string {
  const path = uriPath(uri).replace(/\/+$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}

const isDrive = (part: string | undefined) => /^[A-Za-z]:$/.test(part ?? "");

function joinPaths(base: string, relative: string): string {
  const parts: string[] = [];
  for (const part of `${base}/${relative}`.split("/")) {
    if (part === "..") {
      if (!(parts.length === 1 && isDrive(parts[0]))) {
        parts.pop();
      }
    } else if (part !== "" && part !== ".") {
      parts.push(part);
    }
  }
  const path = `/${parts.join("/")}`;
  return parts.length === 1 && isDrive(parts[0]) ? `${path}/` : path;
}
