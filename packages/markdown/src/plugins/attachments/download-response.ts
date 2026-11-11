/**
 * Pure facts read from an HTTP response for Download Attachments. The command
 * fetches on the host, but these helpers take only strings so they can be
 * tested and reused without a fetch or a Response object. The behaviour to
 * match is Obsidian 1.15.0's (read from its app.js with REA, 2026-11-07); see
 * docs/attachments-parity-next.md for what is still missing.
 */
import { mediaKind } from "../../shared/media-kinds";

/**
 * The file name a server suggests in Content-Disposition (RFC 6266), if any.
 * An RFC 5987 `filename*=UTF-8''…` value wins over a plain `filename`, as
 * RFC 6266 requires: only the extended form can carry non-ASCII names. Only
 * the last path segment is returned, because RFC 6266 section 4.3 warns that
 * a sender may include directory information the recipient must ignore.
 * Callers still sanitise the name and give it a unique one before saving.
 */
export function contentDispositionFilename(
  disposition: string | null | undefined,
): string | undefined {
  if (!disposition) {
    return undefined;
  }
  const extended = parameter(disposition, "filename*");
  const decoded = extended === undefined ? undefined : extendedValue(extended);
  const name = decoded ?? parameter(disposition, "filename");
  return name ? basename(name) : undefined;
}

/**
 * Whether a fetched response is actually an image. A URL that looks like one
 * can still serve a login page or a 404 (`text/html`), so what the server
 * declares in Content-Type decides. Only when it declares nothing does the
 * URL's extension stand in for the missing header.
 */
export function isImageResponse(
  url: string,
  contentType: string | null | undefined,
): boolean {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase();
  if (mime) {
    return mime.startsWith("image/");
  }
  return namesImage(url);
}

/** Read one `name=value` parameter (case-insensitive), unquoting its value. */
function parameter(header: string, name: string): string | undefined {
  for (const part of splitParameters(header)) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      continue;
    }
    if (part.slice(0, eq).trim().toLowerCase() !== name) {
      continue;
    }
    return unquote(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** Split on `;` but keep a quoted `;` or quoted-pair, which are legal inside a filename. */
function splitParameters(header: string): string[] {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  for (let i = 0; i < header.length; i += 1) {
    const char = header[i];
    if (quoted && char === "\\") {
      part += char;
      const next = header[i + 1];
      if (next !== undefined) {
        part += next;
        i += 1;
      }
    } else if (char === '"') {
      quoted = !quoted;
      part += char;
    } else if (char === ";" && !quoted) {
      parts.push(part);
      part = "";
    } else {
      part += char;
    }
  }
  parts.push(part);
  return parts;
}

/** Remove RFC 6266 quoting and quoted-pair escapes from a parameter value. */
function unquote(value: string): string {
  const quoted = /^"((?:[^"\\]|\\.)*)"/u.exec(value);
  if (!quoted) {
    return value;
  }
  return (quoted[1] ?? "").replace(/\\(.)/gu, "$1");
}

/**
 * Decode an RFC 5987 `UTF-8'lang'%…` value. Undefined on a broken escape or
 * a charset we cannot decode, so a plain `filename` can still be used.
 */
function extendedValue(value: string): string | undefined {
  const first = value.indexOf("'");
  const second = value.indexOf("'", first + 1);
  if (first < 0 || second < 0) {
    return undefined;
  }
  const charset = value.slice(0, first).toLowerCase();
  if (charset !== "utf-8" && charset !== "utf8") {
    return undefined;
  }
  try {
    return decodeURIComponent(value.slice(second + 1));
  } catch {
    return undefined;
  }
}

/** The last segment of a possibly POSIX- or Windows-pathed file name. */
function basename(value: string): string {
  return (value.split(/[\\/]/u).at(-1) ?? value).trim();
}

/** Whether the URL's path names an image file: the fallback with no header. */
function namesImage(url: string): boolean {
  try {
    return mediaKind(new URL(url).pathname) === "image";
  } catch {
    return false;
  }
}
