/**
 * The reader's own bookmarks in a PDF: named places ("where I stopped", "the
 * chapter to revisit"). They are not the PDF's outline, which some tools also
 * call bookmarks. Like annotations they are kept outside the PDF, one JSON
 * file per content hash beside the annotation file (`annotation-store`), so
 * the PDF's bytes never change and a moved or renamed copy keeps them.
 *
 * The file is `{ "version": 1, "bookmarks": [{ id, title, page, position,
 * created }] }`. A bookmark's `position` is the page offset the reading
 * position memory keeps (`ReadingPosition.top` and `left`, in points from the
 * page's top-left), so going to it returns to the same spot at any zoom.
 * Raise the version, and keep reading the old one, when the format changes.
 */
import type { OutlineItem } from "./messages";
import { findActiveOutlineItem } from "./outline";
import { isPageOffset } from "./reading-position";

export const BOOKMARK_FILE_VERSION = 1;

/** What the title field accepts; a longer title is refused, not cut. */
export const MAX_BOOKMARK_TITLE_LENGTH = 200;

export interface Bookmark {
  /** Names the bookmark across panes and windows: a rename or delete finds it by this. */
  id: string;
  title: string;
  /** 1-based, as everywhere in Lumiere's shared types. */
  page: number;
  /** Where on the page, in points from its top-left corner. */
  position: { top: number; left: number };
  /** ISO 8601, in UTC. */
  created: string;
}

const SHA256 = /^[0-9a-f]{64}$/u;

/** The bookmark file's name for a PDF with this content hash. */
export function bookmarkStoreName(sha256: string): string {
  if (!SHA256.test(sha256)) {
    throw new Error(`Not a SHA-256: ${sha256}`);
  }
  return `${sha256}.bookmarks.json`;
}

/** Why a title cannot be kept, for the field that asks for it; undefined when it can. */
export function validateBookmarkTitle(title: string): string | undefined {
  const length = title.trim().length;
  if (length === 0) {
    return "Enter a title for the bookmark.";
  }
  return length > MAX_BOOKMARK_TITLE_LENGTH
    ? `A title has at most ${MAX_BOOKMARK_TITLE_LENGTH} characters.`
    : undefined;
}

/**
 * The title offered for a bookmark made at `position`: the outline section it
 * is in (the deepest reached, as Follow Cursor picks it), else `Page N`. The
 * outline is `undefined` while the viewer is still reading it.
 */
export function defaultBookmarkTitle(
  outline: readonly OutlineItem[] | undefined,
  position: { page: number; top: number },
): string {
  const section = findActiveOutlineItem(outline ?? [], position)?.title.trim();
  return section && validateBookmarkTitle(section) === undefined
    ? section
    : `Page ${position.page}`;
}

/** One entry of a file, or undefined when it is not a bookmark. */
export function parseBookmark(value: unknown): Bookmark | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { id, title, page, position, created } = value as Record<
    string,
    unknown
  >;
  const where = parsePosition(position);
  if (
    typeof id !== "string" ||
    id === "" ||
    typeof title !== "string" ||
    validateBookmarkTitle(title) !== undefined ||
    !Number.isSafeInteger(page) ||
    (page as number) < 1 ||
    !where ||
    typeof created !== "string" ||
    !Number.isFinite(Date.parse(created))
  ) {
    return undefined;
  }
  return {
    id,
    title: title.trim(),
    page: page as number,
    position: where,
    created,
  };
}

function parsePosition(value: unknown): Bookmark["position"] | undefined {
  const { top, left } = (value ?? {}) as { top?: unknown; left?: unknown };
  return isPageOffset(top) && isPageOffset(left) ? { top, left } : undefined;
}

/**
 * The bookmarks a file holds. An entry that is not a bookmark is skipped, and
 * of two with one id the first is kept. A file that is not a bookmark file, or
 * comes from a newer version of Lumiere, throws: the caller must not write
 * over it.
 */
export function parseBookmarkFile(text: string): Bookmark[] {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("The file is not a bookmark file.");
  }
  const { version, bookmarks } = (file ?? {}) as {
    version?: unknown;
    bookmarks?: unknown;
  };
  if (typeof version === "number" && version > BOOKMARK_FILE_VERSION) {
    throw new Error("The file was written by a newer version of Lumiere.");
  }
  if (version !== BOOKMARK_FILE_VERSION || !Array.isArray(bookmarks)) {
    throw new Error("The file is not a bookmark file.");
  }
  const seen = new Set<string>();
  const kept: Bookmark[] = [];
  for (const entry of bookmarks) {
    const bookmark = parseBookmark(entry);
    if (bookmark && !seen.has(bookmark.id)) {
      seen.add(bookmark.id);
      kept.push(bookmark);
    }
  }
  return sortBookmarks(kept);
}

/** The file's text, or undefined when there is nothing to keep (no file). */
export function serializeBookmarkFile(
  bookmarks: readonly Bookmark[],
): string | undefined {
  if (bookmarks.length === 0) {
    return undefined;
  }
  const file = {
    version: BOOKMARK_FILE_VERSION,
    bookmarks: sortBookmarks(bookmarks),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Page order, then down the page and across it, then the older one first. */
export function sortBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return [...bookmarks].sort(
    (a, b) =>
      a.page - b.page ||
      a.position.top - b.position.top ||
      a.position.left - b.position.left ||
      compare(a.created, b.created) ||
      compare(a.id, b.id),
  );
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * The three changes a save makes, each by id against the list as it is on
 * disk, so what another pane or window changed meanwhile is kept. They return
 * the list given when there is nothing to change.
 */
export function withBookmark(
  list: readonly Bookmark[],
  bookmark: Bookmark,
): readonly Bookmark[] {
  // A repeat of the same add (a retried save) is not a second bookmark.
  return list.some((existing) => existing.id === bookmark.id)
    ? list
    : [...list, bookmark];
}

export function withRenamedBookmark(
  list: readonly Bookmark[],
  id: string,
  title: string,
): readonly Bookmark[] {
  if (!list.some((bookmark) => bookmark.id === id)) {
    return list;
  }
  return list.map((bookmark) =>
    bookmark.id === id ? { ...bookmark, title: title.trim() } : bookmark,
  );
}

export function withoutBookmark(
  list: readonly Bookmark[],
  id: string,
): readonly Bookmark[] {
  return list.some((bookmark) => bookmark.id === id)
    ? list.filter((bookmark) => bookmark.id !== id)
    : list;
}
