import { DEFAULT_DATE_FORMAT, formatLocalDate } from "../../markdown/templates";
import { uniqueFileName } from "../../shared/file-name";
import { noteSlug } from "./template";

/**
 * `YYYY-MM-DD-title.md`, dated by the local day of the capture instant `at`
 * (an ISO time, in UTC), as daily notes are: a note made in the evening west
 * of Greenwich, or the morning east of it, is filed under today.
 */
export function scratchFileName(
  title: string,
  at: string,
  existing: readonly string[],
): string {
  const captured = new Date(at);
  const day = Number.isNaN(captured.getTime())
    ? "note"
    : formatLocalDate(captured, DEFAULT_DATE_FORMAT);
  return uniqueFileName(`${day}-${noteSlug(title)}.md`, existing);
}
