/**
 * Where a host's file system looks for the file a link path names, and where
 * it makes a note for a link that names none. A click and a preview share
 * this so a link reaches the same file from either; it is pure so that they
 * cannot drift apart.
 */

/** A folder a link path can be joined onto. */
export type LinkFolder = "vault" | "source";

export interface LinkLocation {
  /** The path to join onto each folder in turn, without a leading `/`. */
  relative: string;
  /** Folders to try in this order; the first one that holds the file wins. */
  folders: readonly [LinkFolder, ...LinkFolder[]];
}

/** `./`, `../`, `.` and `..` start from the source note's folder. */
const EXPLICITLY_RELATIVE = /^\.\.?(?:\/|$)/;

/**
 * Where the file a link names is looked for, and nothing else: whether a
 * missing file may be made does not change which existing file a link names
 * (see `creationLocation`). Mirrors Obsidian's `getLinkpathDest`: `./` and
 * `../` start from the source note's folder, a leading `/` from the vault
 * root, and any other path with folders is tried from the vault root first
 * (so `[[wiki/area/Note]]` finds the same file from every note) and then
 * from the source folder (so the Markdown link `sub/Note.md` finds a sibling
 * folder's file). A bare file name is the source note's neighbour, and then
 * the vault root's file of that name, so a link to a note at the root still
 * opens it from a note in a folder.
 */
export function linkLocation(link: string): LinkLocation {
  if (link.startsWith("/")) {
    return { relative: link.slice(1), folders: ["vault"] };
  }
  if (EXPLICITLY_RELATIVE.test(link)) {
    return { relative: link, folders: ["source"] };
  }
  return {
    relative: link,
    folders: link.includes("/") ? ["vault", "source"] : ["source", "vault"],
  };
}

/**
 * Where a note is made for a link that names no existing file. Creating
 * never falls back to another folder, and a foldered path that is neither
 * explicitly relative nor rooted is made at the vault root. A bare file name
 * is made at the vault root here and then follows `newNoteFolder` (see
 * `followsNewNoteFolder`).
 */
export function creationLocation(link: string): {
  relative: string;
  folder: LinkFolder;
} {
  if (link.startsWith("/")) {
    return { relative: link.slice(1), folder: "vault" };
  }
  return {
    relative: link,
    folder: EXPLICITLY_RELATIVE.test(link) ? "source" : "vault",
  };
}

/**
 * Whether a created note goes to `newNoteFolder`: only a bare file name does.
 * A path with folders is made where it says, never nested under the setting.
 */
export function followsNewNoteFolder(link: string): boolean {
  return !link.includes("/");
}
