/**
 * List items shown before a "Showing N of M" control
 * (`properties.listPreviewCount`). 0 shows every item, as Obsidian does.
 */
export const DEFAULT_LIST_PREVIEW_COUNT = 0;

/** Clamp a setting value to 0 (every item) or a preview window of 1–50. */
export function listPreviewCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_LIST_PREVIEW_COUNT;
  }
  return Math.max(0, Math.min(50, Math.floor(n)));
}
