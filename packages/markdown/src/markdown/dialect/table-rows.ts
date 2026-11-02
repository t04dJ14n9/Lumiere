import type { MarkdownConfig } from "@lezer/markdown";

/**
 * Which lines continue a table, as in Obsidian 1.14.4 (measured): GFM takes
 * every line up to a blank one, so `below` right under a table became a row
 * (and editing the table rewrote it as `| below |`). Obsidian ends the table
 * at a line that is not a row: under a header that starts with `|`, a row
 * starts with `|` at the margin; under one that does not, a row has a `|`
 * and does not start with one.
 */
export function continuesTable(header: string, line: string): boolean {
  return header.startsWith("|")
    ? line.startsWith("|")
    : line.includes("|") && !line.startsWith("|");
}

/**
 * A line as a row: from the list item's margin, so its indented rows still
 * start at the margin. A quote's `>` stays (the table widget does not draw
 * tables in quotes, so a quote never holds one).
 */
function rowText(text: string, margin: number): string {
  return /^[ \t]*$/.test(text.slice(0, margin)) ? text.slice(margin) : text;
}

/** Lezer's table parser, which keeps the rows it has read (null before). */
function isTable(parser: object): boolean {
  return Array.isArray((parser as { rows?: unknown }).rows);
}

export const tableRows: MarkdownConfig = {
  parseBlock: [
    {
      name: "ObsidianTableEnd",
      endLeaf(_cx, line, leaf) {
        return (
          leaf.parsers.some(isTable) &&
          !continuesTable(leaf.content, rowText(line.text, line.basePos))
        );
      },
    },
  ],
};
