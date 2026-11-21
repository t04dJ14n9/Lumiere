/**
 * An HTML file a note shows as a card (`![[diagram.html]]`) or a link opens in
 * the HTML viewer, as the community plugins' notes name them.
 */

const HTML_EXTENSION = /\.html?$/iu;

/**
 * Whether a vault path, or an embed or link target, names an HTML file. A
 * `?query` and a `#subpath` (`diagram.html#gamma`) are not part of the name.
 */
export function isHtmlFile(path: string): boolean {
  return HTML_EXTENSION.test(path.split(/[?#]/u)[0] ?? "");
}
