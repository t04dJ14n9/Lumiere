import type { VaultFile, VaultIndex } from "../vault/api";

/** Obsidian's own file types: whatever else a note links to is an attachment. */
const NOT_ATTACHMENTS = new Set(["md", "canvas", "base"]);

/**
 * The attachments that only the notes at `deleted` (vault paths) link to, as
 * Obsidian offers them when a note is deleted: files they link or embed that
 * no other note links to, and that are not going away with them.
 */
export function unlinkedAttachments(
  index: VaultIndex,
  deleted: readonly string[],
): VaultFile[] {
  const going = new Set(deleted);
  const linked = new Map<string, VaultFile>();
  for (const note of deleted) {
    for (const path of index.resolvedLinks(note).keys()) {
      const file = index.file(path);
      if (
        file &&
        !going.has(path) &&
        !NOT_ATTACHMENTS.has(file.extension.toLowerCase())
      ) {
        linked.set(path, file);
      }
    }
  }
  return [...linked.values()].filter((file) =>
    index.backlinks(file.path).every((link) => going.has(link.path)),
  );
}
