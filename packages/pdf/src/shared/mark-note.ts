import MarkdownIt from "markdown-it";

/**
 * A mark's note, as the hover card shows it: Markdown, rendered to HTML that
 * can neither run nor load anything. The note comes from Lumiere's
 * annotation file or from the PDF itself, which anyone may have written, so
 * raw HTML stays text, images are not drawn (a picture would be fetched),
 * and only web and mail links become links. The card opens a link with the
 * viewer's `openExternal` message, which the extension checks again.
 */

/** The longest link a note may open, in UTF-16 code units. */
const MAX_LINK_LENGTH = 2048;

const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Whether a note may open `href`: an absolute web or mail link, nothing else. */
export function isNoteLink(href: unknown): href is string {
  if (typeof href !== "string" || href.length > MAX_LINK_LENGTH) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return (
    LINK_SCHEMES.has(url.protocol) &&
    (url.protocol === "mailto:" || url.hostname !== "")
  );
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
}).disable("image");
// A link markdown-it refuses is left as the text it was written as.
markdown.validateLink = isNoteLink;

/** The note as HTML for the card; undefined when there is nothing to show. */
export function renderNote(note: string): string | undefined {
  return note.trim() ? markdown.render(note) : undefined;
}
