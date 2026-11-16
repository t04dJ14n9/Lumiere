/** What reads a paragraph's inline syntax: the editor's Markdown parser. */
export interface InlineParser {
  parseInline(
    text: string,
    offset: number,
  ): readonly { type: number; from: number; to: number }[];
  readonly nodeSet: { readonly types: readonly { readonly name: string }[] };
}

/**
 * Whether `text` ends inside an Obsidian `%%` comment: a `%%` in it opens a
 * comment that does not close in it. Shared by the editor's parser and the
 * reading view's, which both pass the editor's inline parser, so they agree
 * on where a paragraph ends.
 *
 * Asked of the parser itself: one more `%%` at the end closes a comment
 * exactly when one is open. So a `%%` in code, math, a tag or after an
 * escape stays text, and one in emphasis or a link label still opens.
 */
export function hasOpenComment(text: string, parser: InlineParser): boolean {
  if (!text.includes("%%")) {
    return false;
  }
  const end = text.length + 2;
  return parser
    .parseInline(`${text}%%`, 0)
    .some(
      (element) =>
        element.to === end &&
        parser.nodeSet.types[element.type]?.name === "ObsidianComment",
    );
}
