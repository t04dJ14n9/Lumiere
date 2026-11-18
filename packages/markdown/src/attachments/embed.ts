import { folderOf, nameOf, relativeVaultPath } from "../shared/vault-path";
import { encodeLinkPath } from "../shared/workspace-path";

export interface EmbedLink {
  /** The attachment's vault path. */
  readonly path: string;
  /** The note's vault path. */
  readonly notePath: string;
  /** Obsidian's Use [[Wikilinks]]. */
  readonly useWikilinks: boolean;
  /** Obsidian's New link format. */
  readonly format: "shortest" | "relative" | "absolute";
  /** Whether no other vault file has the attachment's name. */
  readonly isNameUnique: boolean;
  /** Text shown for the image: a wikilink's alias, a Markdown image's alt. */
  readonly alt?: string;
}

/** What a link to the attachment names: its path, or the shortest that is unambiguous. */
function linkTarget(link: EmbedLink): string {
  if (link.format === "relative") {
    return relativeVaultPath(folderOf(link.notePath), link.path);
  }
  return link.format === "shortest" && link.isNameUnique
    ? nameOf(link.path)
    : link.path;
}

/**
 * The value a property gets for a saved attachment: always a wikilink, as
 * Obsidian writes it, because a property's Markdown link is not a link.
 */
export function propertyLinkFor(link: EmbedLink): string {
  return `[[${linkTarget(link)}]]`;
}

/** The embed a note gets for a saved attachment, as Obsidian would write it. */
export function embedFor(link: EmbedLink): string {
  const target = linkTarget(link);
  // Brackets and pipes in the text would end the link early.
  const alt = (link.alt ?? "")
    .replace(/[[\]|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!link.useWikilinks) {
    return `![${alt}](${encodeLinkPath(target)})`;
  }
  return alt && alt.toLowerCase() !== target.toLowerCase()
    ? `![[${target}|${alt}]]`
    : `![[${target}]]`;
}
