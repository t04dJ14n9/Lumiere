const QUOTE_MARKER = /^ {0,3}> ?/u;

/** Up to `limit` leading `>` markers of a line: how many, and what follows. */
function skipQuoteMarkers(
  line: string,
  limit: number,
): { depth: number; rest: string } {
  let depth = 0;
  let rest = line;
  while (depth < limit) {
    const match = QUOTE_MARKER.exec(rest);
    if (!match) {
      break;
    }
    depth++;
    rest = rest.slice(match[0].length);
  }
  return { depth, rest };
}

/**
 * A block's Markdown as it reads outside the quotes it sits in. A block that
 * starts after `> ` on its first line (display math, a diagram fence) has the
 * same markers on each later line; rendered on its own, those markers would
 * become part of the formula or the code. `linePrefix` is the text of the
 * block's first line before the block. Lines without the markers (lazy
 * continuation) are kept as written.
 */
export function unquotedBlock(source: string, linePrefix: string): string {
  const { depth } = skipQuoteMarkers(linePrefix, Infinity);
  if (depth === 0 || !source.includes("\n")) {
    return source;
  }
  const [first, ...rest] = source.split("\n");
  const unquoted = rest.map((line) => skipQuoteMarkers(line, depth).rest);
  return [first, ...unquoted].join("\n");
}
