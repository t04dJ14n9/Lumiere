import { nativeLinkContext } from "./native-link-context";
/** Conservative inline Markdown links. Unsupported syntax stays with the host. */
export interface NativeLink {
  from: number;
  to: number;
  href: string;
}

export function nativeLinks(text: string): NativeLink[] {
  if (text.length > 2_000_000) {
    return [];
  }
  const result: NativeLink[] = [];
  let offset = 0;
  for (const line of nativeLinkContext(text).split("\n")) {
    result.push(...inlineLinks(line, offset));
    offset += line.length + 1;
  }
  return result;
}

function inlineLinks(line: string, offset: number): NativeLink[] {
  const result: NativeLink[] = [];
  const labels = /(?<!!)\[[^\]\n[]*\]\(\s*/g;
  for (const match of line.matchAll(labels)) {
    if (escaped(line, match.index)) {
      continue;
    }
    const destination = readLinkDestination(
      line,
      match.index + match[0].length,
    );
    if (!destination) {
      continue;
    }
    const { href } = destination;
    // Entities require a complete HTML entity parser; leave them to the host.
    if (/&(?:#\w+|\w+);/.test(href)) {
      continue;
    }
    result.push({
      from: offset + destination.from,
      to: offset + destination.to,
      href,
    });
  }
  return result;
}

/**
 * The destination of an inline link whose `(` (and the space after it) ends
 * just before `start` in `line`: `<angle form>` or a bare one with balanced
 * parentheses, then an optional title and the closing `)`. `from`/`to` are
 * the destination's own range, without angle brackets; `href` has its
 * backslash escapes removed but is still percent-encoded.
 */
export function readLinkDestination(
  line: string,
  start: number,
): NativeLink | undefined {
  const end = destinationEnd(line, start);
  if (end === undefined) {
    return undefined;
  }
  const angle = line[start] === "<";
  const from = start + (angle ? 1 : 0);
  const to = end - (angle ? 1 : 0);
  if (!/^\s*(?:["'][^\n]*?["']\s*)?\)/.test(line.slice(end))) {
    return undefined;
  }
  const href = line
    .slice(from, to)
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1");
  return { from, to, href };
}

/** Whether the character at `at` is escaped by an odd run of backslashes. */
export function escaped(text: string, at: number): boolean {
  let count = 0;
  while (at > 0 && text[--at] === "\\") {
    count++;
  }
  return count % 2 === 1;
}

function destinationEnd(line: string, start: number): number | undefined {
  const angle = line[start] === "<";
  let depth = 0;
  for (let at = start + (angle ? 1 : 0); at < line.length; at++) {
    if (escaped(line, at)) {
      continue;
    }
    const char = line[at];
    if (angle && char === ">") {
      return at + 1;
    }
    if (angle) {
      continue;
    }
    if (char === "(") {
      depth++;
    }
    if (char === ")" && depth-- === 0) {
      return at;
    }
    if (/\s/.test(char ?? "")) {
      return at;
    }
  }
  return undefined;
}

/** Decode once, after separating the fragment; encoded # remains a filename. */
export function localFragment(
  href: string,
): { path: string; fragment: string } | undefined {
  const hash = href.indexOf("#");
  if (hash < 0 || hash === href.length - 1) {
    return undefined;
  }
  try {
    const path = decodeURIComponent(href.slice(0, hash));
    const fragment = href.slice(hash + 1);
    decodeURIComponent(fragment);
    if (
      /^[a-z][\w+.-]*:/i.test(path) ||
      path.startsWith("//") ||
      path.includes("\\") ||
      [...path, ...decodeURIComponent(fragment)].some(
        (char) => char.charCodeAt(0) < 32,
      )
    ) {
      return undefined;
    }
    return { path, fragment };
  } catch {
    return undefined;
  }
}
