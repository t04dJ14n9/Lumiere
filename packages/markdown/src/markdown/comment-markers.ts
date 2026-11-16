/**
 * Whether `text` ends inside an Obsidian `%%` comment: it has an odd number
 * of `%%` markers, so the last one is still open. Shared by the editor's
 * parser and the reading view's, so they agree on where a paragraph ends.
 */
export function hasOpenComment(text: string): boolean {
  let count = 0;
  for (let at = text.indexOf("%%"); at >= 0; at = text.indexOf("%%", at + 2)) {
    count++;
  }
  return count % 2 === 1;
}
