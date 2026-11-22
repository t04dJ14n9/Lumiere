import { useSyncExternalStore } from "react";
import type { Bookmark } from "../../shared/bookmarks";

/**
 * The PDF's bookmarks as the extension last sent them, for the Bookmarks
 * tab. The extension reads and writes the file; this only shows what it says.
 * Kept outside the components, like the panel's state, so a rebuilt viewer
 * has them from the start.
 */
export interface BookmarksState {
  readonly items: readonly Bookmark[];
  /** Why the file could not be read, when it could not. */
  readonly problem?: string | undefined;
}

let state: BookmarksState = { items: [] };
const listeners = new Set<() => void>();

export function rememberBookmarks(
  items: readonly Bookmark[],
  problem?: string,
): void {
  state = { items, problem };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBookmarks(): BookmarksState {
  return useSyncExternalStore(subscribe, () => state);
}
