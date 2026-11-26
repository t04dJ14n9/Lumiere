import type { WorkspaceStorage } from "./host";

/**
 * Where a note's collapsed Properties are kept: the notes (by URI) whose sheet
 * is collapsed, in the workspace's storage. Properties owns it
 * (`plugins/properties/collapse-store.ts`); the editor reads it too, to say in
 * the `ready` answer and the first-paint snapshot whether to draw the sheet
 * expanded or as its heading alone.
 */
export const COLLAPSED_NOTES_KEY = "markdownPropertiesCollapsedNotes";

export function collapsedNotes(
  storage: Pick<WorkspaceStorage, "get">,
): Record<string, true> {
  const value = storage.get<unknown>(COLLAPSED_NOTES_KEY, {});
  return typeof value === "object" && value !== null
    ? (value as Record<string, true>)
    : {};
}

export function isPropertiesCollapsed(
  storage: Pick<WorkspaceStorage, "get">,
  note: string,
): boolean {
  return collapsedNotes(storage)[note] === true;
}
