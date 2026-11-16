/** What reads a paragraph's inline syntax: the editor's Markdown parser. */
export interface InlineParser {
  parseInline(
    text: string,
    offset: number,
  ): readonly { from: number; to: number }[];
}

/**
 * Whether `text` ends inside an Obsidian `%%` comment: a `%%` in it opens a
 * comment that does not close in it. Shared by the editor's parser and the
 * reading view's, which both pass the editor's inline parser, so they agree
 * on where a paragraph ends.
 *
 * A `%%` the inline parser made part of something (a comment it closes,
 * code, math, a tag, a link, an escape: `\%%` is a `%` and a `%`) is not an
 * opener; one left over is, since a closed comment would be an element.
 */
export function hasOpenComment(text: string, parser: InlineParser): boolean {
  const elements = parser.parseInline(text, 0);
  for (let at = text.indexOf("%%"); at >= 0; at = text.indexOf("%%", at + 2)) {
    if (!elements.some((element) => element.from <= at && at < element.to)) {
      return true;
    }
  }
  return false;
}
