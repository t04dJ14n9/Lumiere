/**
 * A Markdown link's classes. A rendered label pointing outside the vault
 * (any `scheme:` address) carries Obsidian's external-link mark. Internal
 * misses get `is-unresolved`, same as rendered wikilinks.
 */
export function linkClass(
  isRendered: boolean,
  href: string,
  unresolved = false,
): string {
  if (!isRendered) {
    return "md-link";
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
    return "md-link md-link-rendered md-link-external";
  }
  return unresolved
    ? "md-link md-link-rendered is-unresolved"
    : "md-link md-link-rendered";
}
