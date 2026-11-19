/**
 * The file tree as the rows it shows, and which of them to draw: a vault of
 * tens of thousands of files draws only the rows in view (FileTree.tsx), so
 * opening a folder or scrolling costs the same in any vault.
 */
import type { FileEntry } from "./api";
import type { Folder } from "./tree";
import type { OpenFolders } from "./tree-state";

/** Every row is this tall (styles.css `.tree-row`), so its place is its index. */
export const ROW_HEIGHT = 24;

export type TreeRow =
  | {
      readonly kind: "folder";
      readonly path: string;
      readonly name: string;
      readonly depth: number;
      readonly isOpen: boolean;
    }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly name: string;
      readonly depth: number;
      readonly entry: FileEntry;
    };

/** The rows shown: each folder, then, when it is open, what is in it; files after folders. */
export function visibleRows(root: Folder, open: OpenFolders): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (folder: Folder, depth: number) => {
    // Sorted here: a folder made in the window comes after the listed ones.
    const children = [...folder.folders.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      const isOpen = open.has(child.path);
      rows.push({
        kind: "folder",
        path: child.path,
        name: child.name,
        depth,
        isOpen,
      });
      if (isOpen) {
        visit(child, depth + 1);
      }
    }
    for (const entry of folder.files) {
      rows.push({
        kind: "file",
        path: entry.path,
        name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
        depth,
        entry,
      });
    }
  };
  visit(root, 0);
  return rows;
}

/** The rows to draw, `start` to `end` (exclusive), for a list scrolled this far. */
export function rowWindow({
  count,
  scrollTop,
  viewport,
  overscan = 10,
}: {
  readonly count: number;
  readonly scrollTop: number;
  /** The visible height; 0 before it is measured, which draws a screenful. */
  readonly viewport: number;
  readonly overscan?: number;
}): { readonly start: number; readonly end: number } {
  const shown = Math.ceil((viewport || 800) / ROW_HEIGHT);
  const first = Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, first + shown + overscan),
  };
}

/**
 * Where to scroll so row `index` is in view, as `scrollIntoView` with
 * `block: "nearest"` would; undefined when it already is.
 */
export function scrollToShow(
  index: number,
  { scrollTop, viewport }: { scrollTop: number; viewport: number },
): number | undefined {
  const top = index * ROW_HEIGHT;
  if (top < scrollTop) {
    return top;
  }
  if (top + ROW_HEIGHT > scrollTop + viewport) {
    return top + ROW_HEIGHT - viewport;
  }
  return undefined;
}
