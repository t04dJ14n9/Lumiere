/**
 * What the text typed after `[[` asks the suggestion list for: notes, a
 * note's headings, or its blocks. Pure, so the Lumia editor (a CodeMirror
 * line) and VS Code's text editor (a line of the document) read a trigger
 * the same way.
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
}

/** `before` is the text of the caret's line up to the caret. */
export function linkTrigger(before: string): LinkTrigger | undefined {
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
