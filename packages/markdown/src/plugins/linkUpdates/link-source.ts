/** A link's source text split around the part a rename replaces. */
export interface LinkSource {
  /** `[[`, `![[`, `[text](` or `![alt](`, with any spaces before the path. */
  opening: string;
  /** The path as written, without its `#subpath`. */
  path: string;
  /** `#subpath` as written, or `""`. */
  subpath: string;
  /** Whether a Markdown destination is written in `<…>`. */
  isAngled: boolean;
  /** The alias with its pipe, title or closing brackets after the subpath. */
  closing: string;
}

/**
 * `[[path#subpath|alias]]`. The pipe may be escaped (`\|`) inside a table
 * row, and must stay escaped or the row gains a cell.
 */
const WIKILINK = /^(!?\[\[)(.*?)((?:\\?\|.*)?\]\])$/su;

/**
 * `[text](destination "title")`, the destination bare or in `<…>`. Anchored
 * at both ends, so a bare destination may hold balanced parentheses and
 * quotes: only whitespace ends it, and `Old"note.md` is a valid file name.
 * A title may hold its own closing delimiter backslash-escaped.
 */
const MARKDOWN_LINK =
  /^(!?\[.*?\]\(\s*)(<[^>\n]*>|\S+?)((?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?\s*\))$/su;

/** The parts of a wikilink or inline Markdown link, or `undefined`. */
export function linkSource(original: string): LinkSource | undefined {
  const wikilink = WIKILINK.exec(original);
  if (wikilink) {
    const [, opening = "", inner = "", closing = ""] = wikilink;
    return { opening, ...splitAtHash(inner), isAngled: false, closing };
  }
  const markdown = MARKDOWN_LINK.exec(original);
  if (!markdown) {
    return undefined;
  }
  const [, opening = "", destination = "", closing = ""] = markdown;
  const isAngled = destination.startsWith("<");
  const written = isAngled ? destination.slice(1, -1) : destination;
  return { opening, ...splitAtHash(written), isAngled, closing };
}

/** Path and `#subpath` exactly as written, spaces included. */
function splitAtHash(written: string): { path: string; subpath: string } {
  const hash = written.indexOf("#");
  return hash < 0
    ? { path: written, subpath: "" }
    : { path: written.slice(0, hash), subpath: written.slice(hash) };
}

/** `source` with a new path and subpath, written in its own form. */
export function formatLinkSource(
  source: LinkSource,
  path: string,
  subpath: string,
): string {
  if (source.opening.endsWith("[[")) {
    return `${source.opening}${path}${subpath}${source.closing}`;
  }
  const destination = source.isAngled
    ? `<${path}${subpath}>`
    : encodeDestination(path) + subpath;
  return `${source.opening}${destination}${source.closing}`;
}

/**
 * Percent-encode what would end or escape a bare destination: spaces,
 * backslashes and control characters, as Obsidian writes them, and the
 * parentheses that have no partner, which Obsidian leaves and the parser
 * reads as the link's end. Balanced pairs stay as they are.
 */
export function encodeDestination(text: string): string {
  const unpaired = unpairedParentheses(text);
  return Array.from(text, (unit, index) => {
    if (unpaired.has(index)) {
      return unit === "(" ? "%28" : "%29";
    }
    return unit === " " || unit === "\\" || unit.charCodeAt(0) < 0x20
      ? encodeURIComponent(unit)
      : unit;
  }).join("");
}

/** The indexes, in code points, of the `(` and `)` that no other one pairs. */
function unpairedParentheses(text: string): Set<number> {
  const unpaired = new Set<number>();
  const open: number[] = [];
  for (const [index, unit] of Array.from(text).entries()) {
    if (unit === "(") {
      open.push(index);
    } else if (unit === ")" && open.pop() === undefined) {
      unpaired.add(index);
    }
  }
  for (const index of open) {
    unpaired.add(index);
  }
  return unpaired;
}
