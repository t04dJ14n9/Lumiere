import type { WorkspaceStorage } from "../../shared/host";

export const RECENT_KEY = "markdownQuickSwitcherRecent";
const MAX_RECENT = 50;

/**
 * Vault file URIs most recently opened in this workspace, newest first:
 * notes, and attachments opened from the switcher (Obsidian's order).
 */
export function readRecent(storage: WorkspaceStorage): string[] {
  const value = storage.get<unknown>(RECENT_KEY, []);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Record a file open at the front of the recent list. */
export function rememberOpen(
  storage: WorkspaceStorage,
  uri: string,
): PromiseLike<void> {
  const next = [
    uri,
    ...readRecent(storage).filter((entry) => entry !== uri),
  ].slice(0, MAX_RECENT);
  return storage.update(RECENT_KEY, next);
}
