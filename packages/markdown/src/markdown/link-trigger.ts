import { decodeLinkPath, isExternalLink } from "../shared/vault-path";

/**
 * What the text typed after `[[`, or inside the parentheses of a Markdown
 * link (`[text](`), asks the suggestion list for: notes, a note's headings,
 * or its blocks. Pure, so the Lumiere editor (a CodeMirror line) and VS
 * Code's text editor (a line of the document) read a trigger the same way.
 */
export interface LinkTrigger {
  kind: "link" | "heading" | "block";
  query: string;
  /** The note a heading or block belongs to; empty for the note being edited. */
  note?: string;
  /** `^` typed without `#` (`[[Note^`): the link gets its `#`. */
  bare?: boolean;
  /** Where accepting starts replacing: an offset in the text before the caret. */
  from: number;
  closeLink: true;
  /**
   * Accepting keeps what was typed and only finishes the link, as Obsidian
   * does while an alias is typed after `|`.
   */
  keepTyped?: true;
  /**
   * The text is the destination of a Markdown link, so `)` finishes it, and
   * `query` and `note` are the typed text decoded (`%20` is a space). `root`:
   * the path was typed with a leading `/`, which names the vault's root.
   */
  destination?: "relative" | "root";
}

/** `before` is the text of the caret's line up to the caret. */
export function linkTrigger(before: string): LinkTrigger | undefined {
  return wikilinkTrigger(before) ?? destinationTrigger(before);
}

function wikilinkTrigger(before: string): LinkTrigger | undefined {
  const match = /\[\[([^\]\n[]*)$/.exec(before);
  if (!match) {
    return undefined;
  }
  const typed = match[1]!;
  const end = before.length;
  const bar = typed.indexOf("|");
  if (bar >= 0) {
    // An alias is being typed: the note stays offered, as in Obsidian, and
    // accepting keeps what was typed and finishes the link.
    return {
      kind: "link",
      query: typed.slice(0, bar),
      from: end,
      closeLink: true,
      keepTyped: true,
    };
  }
  const base = { from: end - typed.length, closeLink: true } as const;
  if (typed.startsWith("^^")) {
    return { ...base, kind: "block", query: typed.slice(2) };
  }
  const hash = typed.indexOf("#");
  const caret = typed.lastIndexOf("^");
  if (hash < 0 && caret >= 0) {
    // `[[Note^` lists the note's blocks too, as in Obsidian; the `#` comes
    // with the picked id.
    const query = typed.slice(caret + 1);
    return {
      ...base,
      kind: "block",
      query,
      note: typed.slice(0, caret),
      bare: true,
      from: end - query.length - 1,
    };
  }
  if (hash < 0) {
    return { ...base, kind: "link", query: typed };
  }
  const fragment = typed.slice(hash + 1);
  const block = fragment.startsWith("^");
  const query = block ? fragment.slice(1) : fragment;
  return {
    ...base,
    kind: block ? "block" : "heading",
    query,
    note: typed.slice(0, hash),
    from: end - query.length,
  };
}

/**
 * The end of the link text and the destination typed so far: `](` and then
 * no space, parenthesis or `<` (an angle-bracketed destination may hold
 * spaces, which this does not follow). `![alt](` is the same, as `![[` is.
 */
const DESTINATION = /\]\(([^\s()<]*)$/;

function destinationTrigger(before: string): LinkTrigger | undefined {
  const match = DESTINATION.exec(before);
  if (!match) {
    return undefined;
  }
  const typed = match[1]!;
  const close = match.index;
  if (
    isExternalLink(typed) ||
    isEscaped(before, close) ||
    !hasLinkText(before, close)
  ) {
    return undefined;
  }
  const end = before.length;
  const base = {
    closeLink: true,
    destination: typed.startsWith("/") ? "root" : "relative",
  } as const;
  const hash = typed.indexOf("#");
  if (hash < 0) {
    return {
      ...base,
      kind: "link",
      query: withoutDirectoryPrefix(decodeLinkPath(typed)),
      from: end - typed.length,
    };
  }
  const fragment = typed.slice(hash + 1);
  const block = fragment.startsWith("^");
  const query = block ? fragment.slice(1) : fragment;
  return {
    ...base,
    kind: block ? "block" : "heading",
    query: decodeLinkPath(query),
    note: decodeLinkPath(typed.slice(0, hash)),
    from: end - query.length,
  };
}

/**
 * Whether the `]` at `close` ends a link's text: a `[` before it on the line
 * balances it. `[[Note]](` is a wikilink and a parenthesis, not a link.
 */
function hasLinkText(before: string, close: number): boolean {
  let depth = 1;
  for (let at = close - 1; at >= 0; at--) {
    if (isEscaped(before, at)) {
      continue;
    }
    if (before[at] === "]") {
      depth++;
    } else if (before[at] === "[" && --depth === 0) {
      return !(before[at + 1] === "[" && before[close - 1] === "]");
    }
  }
  return false;
}

function isEscaped(text: string, at: number): boolean {
  let slashes = 0;
  while (text[at - 1 - slashes] === "\\") {
    slashes++;
  }
  return slashes % 2 === 1;
}

/**
 * A path's own name, to match: where it starts (`/`, `./`, `../`) says where
 * to look for the note, not what it is called.
 */
function withoutDirectoryPrefix(path: string): string {
  const name = path.replace(/^(?:\.{1,2}\/|\/)+/, "");
  return name === "." || name === ".." ? "" : name;
}
