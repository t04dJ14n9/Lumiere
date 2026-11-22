import { splitLinktext, splitMarkdownDestination } from "./vault-path";

/**
 * An HTML file a note shows as a card (`![[diagram.html]]`) or a link opens in
 * the HTML viewer, as the community plugins' notes name them.
 *
 * There are two questions, and a `#` or `?` means a different thing in each:
 * in a file's own path it is part of the name (`C# notes.html`, `a?b.html`),
 * in a link's text it starts a subpath (`a.html#gamma`), or is encoded
 * (`C%23%20notes.html`, a Markdown link to the first).
 */

const HTML_EXTENSION = /\.html?$/iu;

/**
 * Whether a file path, a vault path or the decoded path of a URI, names an
 * HTML file: by its extension alone. Nothing is stripped, so a `#` or `?` in
 * the name stays in it.
 */
export function isHtmlPath(path: string): boolean {
  return HTML_EXTENSION.test(path);
}

/**
 * Whether the text of a link or embed target names an HTML file, read as
 * `resources` reads it: a wikilink target ends at its first `#` (its subpath)
 * and is not decoded; a Markdown destination ends at its first literal `#`
 * and is then percent-decoded, so `%23` stays a `#` of the name. A `?` is part
 * of the name in both.
 */
export function isHtmlLinkTarget(
  target: string,
  syntax: "markdown" | "wikilink",
): boolean {
  const { path } =
    syntax === "markdown"
      ? splitMarkdownDestination(target)
      : splitLinktext(target);
  return isHtmlPath(path);
}
