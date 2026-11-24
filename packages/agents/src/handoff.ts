/**
 * The text Copy Link for Agent writes for a note selection, as
 * docs/agent-handoff-format.md defines it: Lumiere writes it, and
 * Lumiere PDF's agent bridge returns it for the note selection.
 */

/** `@notes/a.md#12-18` (one line: `#12`), with `noteLocation` outside the workspace folder. */
export function noteReference(
  path: string,
  startLine: number,
  endLine: number,
  isDirty: boolean,
): string {
  const lines =
    startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
  const location = noteLocation(path);
  return isDirty
    ? `${location} (unsaved, lines ${lines})`
    : `@${location}#${lines}`;
}

/**
 * How a reference names a note outside the one workspace folder: a local file
 * by its absolute path as written, `/notes/赠礼.md`, which agents read as it
 * stands, and anything else by its full URI. A path that would not read back
 * unambiguously (whitespace, `#`, `%`, a drive letter, control characters)
 * keeps the URI, `file:///My%20Notes/a.md`.
 */
export function noteLocation(uri: string): string {
  // A local file only: `file:///…` with no host, query or fragment.
  const local = /^file:\/\/(\/[^?#]*)$/iu.exec(uri);
  if (!local) {
    return uri;
  }
  let path: string;
  try {
    path = decodeURIComponent(local[1]!);
  } catch {
    return uri;
  }
  const isUnclear = (character: string): boolean =>
    /[\s#%]/u.test(character) ||
    character.charCodeAt(0) < 0x20 ||
    character.charCodeAt(0) === 0x7f;
  return !path.startsWith("/") ||
    /^\/[A-Za-z]:/u.test(path) ||
    [...path].some(isUnclear)
    ? uri
    : path;
}

/**
 * A note's absolute path, as `noteLocation` writes it, back as a file URI.
 */
export function fileUriOfPath(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The reference, a blank line, the selection quoted line by line with `> `,
 * then a newline, so a paste into a chat leaves the caret on a line of its own.
 */
export function notePayload(reference: string, text: string): string {
  const lines = text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "").split("\n");
  return `${reference}\n\n${lines.map((line) => (line ? `> ${line}` : ">")).join("\n")}\n`;
}
