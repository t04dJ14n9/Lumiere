/**
 * The file name a server gives a download in `Content-Disposition`
 * (RFC 6266), reduced to a base name that is safe to save under. The server
 * is untrusted: it may send a path, control characters or a name that is not
 * text at all.
 */

/** `;name=value` pairs after the disposition type; the first of a name wins. */
function parameters(header: string): Map<string, string> {
  const found = new Map<string, string>();
  const pair = /;\s*([^\s=;]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/gu;
  for (const [, name, raw] of header.matchAll(pair)) {
    const key = name!.toLowerCase();
    if (found.has(key)) {
      continue;
    }
    const value = raw!.trim();
    found.set(
      key,
      value.startsWith('"')
        ? value.slice(1, -1).replace(/\\(.)/gu, "$1")
        : value,
    );
  }
  return found;
}

/** `charset'language'%XX…` (RFC 8187), or undefined for one that cannot be read. */
function decodeExtended(value: string): string | undefined {
  const match = /^([^']*)'[^']*'(.*)$/su.exec(value);
  if (!match) {
    return undefined;
  }
  const charset = match[1]!.toLowerCase();
  try {
    if (charset === "utf-8") {
      return decodeURIComponent(match[2]!);
    }
    if (charset === "iso-8859-1") {
      return match[2]!.replace(/%([0-9a-f]{2})/giu, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    }
  } catch {
    // a malformed escape, or bytes that are not UTF-8
  }
  return undefined;
}

/**
 * fetch reads header bytes as Latin-1, so a server that sends its UTF-8 name
 * raw arrives as mojibake (`naÃ¯ve`); undo that when the bytes are UTF-8.
 */
function repairLatin1(value: string): string {
  if ([...value].some((char) => char.charCodeAt(0) > 0xff)) {
    return value;
  }
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

/** The last path segment, without control characters; undefined when none is left. */
function baseName(name: string): string | undefined {
  const printable = [...name]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
  const last = printable.split(/[\\/]/u).at(-1)?.trim();
  return last && last !== "." && last !== ".." ? last : undefined;
}

/**
 * The base name in a `Content-Disposition` header, preferring `filename*`
 * to `filename`, or undefined when there is none or nothing usable in it.
 */
export function servedFileName(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }
  const found = parameters(header);
  const extended = found.get("filename*");
  const plain = found.get("filename");
  const name =
    (extended === undefined ? undefined : decodeExtended(extended)) ??
    (plain === undefined ? undefined : repairLatin1(plain));
  return name === undefined ? undefined : baseName(name);
}
