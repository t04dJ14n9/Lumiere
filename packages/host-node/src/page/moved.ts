/**
 * A page whose note was renamed or moved: the embedder opens the note at
 * its new path (embedding.ts `MovedMessage`), as a page at the same query
 * but for `path`, and the scroll position the editor saved goes with it.
 */

/** Where a page keeps the editor's view state, by its query or its note (shim.ts). */
export function stateKey(id: string): string {
  return `lumiere:state:${id}`;
}

/**
 * The page's query with its note at `path`, written as the embedder writes
 * it (URLSearchParams, the other parameters kept in their order).
 */
export function movedSearch(search: string, path: string): string {
  const query = new URLSearchParams(search);
  query.set("path", path);
  return `?${query.toString()}`;
}

/** Copy the saved view state from the page at query `from` to the one at `to`. */
export function carryState(
  from: string,
  to: string,
  storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage,
): void {
  try {
    const saved = storage.getItem(stateKey(from));
    if (saved !== null) {
      storage.setItem(stateKey(to), saved);
    }
  } catch {
    // Blocked storage only loses the scroll position.
  }
}
