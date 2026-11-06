/**
 * Where a host's file system looks for the file a link path names. Both hosts
 * (VS Code and the portable one) share this so a link reaches the same file
 * in either; it is pure so that they cannot drift apart.
 */

/** A folder a link path can be joined onto. */
export type LinkFolder = "vault" | "source";

export interface LinkLocation {
  /** The path to join onto each folder in turn, without a leading `/`. */
  relative: string;
  /** Folders to try in this order; the first one that holds the file wins. */
  folders: readonly [LinkFolder, ...LinkFolder[]];
}

/**
 * Mirrors Obsidian's `getLinkpathDest`: `./` and `../` start from the source
 * note's folder, a leading `/` from the vault root, and any other path with
 * folders is tried from the vault root first (so `[[wiki/area/Note]]` finds
 * the same file from every note) and then from the source folder (so the
 * Markdown link `sub/Note.md` finds a sibling folder's file). A bare file
 * name is the source note's neighbour. Creating a note never falls back, and
 * a foldered path that is neither explicitly relative nor rooted is made at
 * the vault root.
 */
export function linkLocation(link: string, create: boolean): LinkLocation {
  if (link.startsWith("/")) {
    return { relative: link.slice(1), folders: ["vault"] };
  }
  if (/^\.\.?(?:\/|$)/.test(link)) {
    return { relative: link, folders: ["source"] };
  }
  if (create) {
    return { relative: link, folders: ["vault"] };
  }
  return {
    relative: link,
    folders: link.includes("/") ? ["vault", "source"] : ["source"],
  };
}

/**
 * Whether a created note goes to `newNoteFolder`: only a bare file name does.
 * A path with folders is made where it says, never nested under the setting.
 */
export function followsNewNoteFolder(link: string): boolean {
  return !link.includes("/");
}
