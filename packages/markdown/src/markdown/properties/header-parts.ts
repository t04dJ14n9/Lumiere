/**
 * Locate an Obsidian-style YAML frontmatter fence without loading the YAML
 * package. Callers that only need the body span (or a no-fence fast path)
 * stay off the YAML runtime.
 */
export function headerParts(source: string) {
  // A byte order mark (hosts that read files as text keep it) is the file's
  // encoding, not the note's first line, so it may precede the fence.
  const opening = /^\uFEFF?---\r?\n/.exec(source);
  if (!opening) {
    return undefined;
  }
  const rest = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) {
    return undefined;
  }
  const offset = opening[0].length;
  const body = rest.slice(0, closing.index);
  const end = offset + closing.index + closing[0].length;
  return {
    body,
    // Where the header's text starts: after the byte order mark, if any.
    start: opening[0].startsWith("﻿") ? 1 : 0,
    offset,
    end,
    raw: source.slice(0, end),
    eol: opening[0].endsWith("\r\n") ? "\r\n" : "\n",
  };
}
