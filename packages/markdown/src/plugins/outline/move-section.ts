import { metadata } from "../../markdown/metadata";
import type { TextEdit } from "../../shared/host";

/**
 * Where a dragged section goes: before the heading that starts at
 * `beforeHeading`, or at the end of the note when it is undefined.
 */
export interface SectionMove {
  /** Offset of the dragged heading's line. */
  heading: number;
  beforeHeading: number | undefined;
}

/**
 * The edit that moves a heading's section, as Obsidian's Outline does when a
 * heading is dropped: the heading, its text and its subheadings (up to the
 * next heading of the same or a higher level) are cut and put back before
 * the target heading. Levels are kept. The text before the insertion point
 * and the moved section each end in a blank line, so neither runs into the
 * next heading. Undefined when nothing would change: an unknown heading, or a
 * target inside the dragged section or right after it.
 *
 * Offsets are in `text`; the edit is the smallest single replacement.
 */
export function moveSectionEdit(
  text: string,
  move: SectionMove,
): TextEdit | undefined {
  const headings = metadata(text).headings;
  const dragged = headings.findIndex(
    (heading) => heading.position.start.offset === move.heading,
  );
  const isKnownTarget =
    move.beforeHeading === undefined ||
    headings.some(
      (heading) => heading.position.start.offset === move.beforeHeading,
    );
  if (dragged < 0 || !isKnownTarget) {
    return undefined;
  }
  const level = headings[dragged]!.level;
  const sectionFrom = move.heading;
  const next = headings
    .slice(dragged + 1)
    .find((heading) => heading.level <= level);
  const sectionTo = next?.position.start.offset ?? text.length;
  const insertAt = move.beforeHeading ?? text.length;
  if (insertAt >= sectionFrom && insertAt <= sectionTo) {
    return undefined;
  }
  const section = endWithBlankLine(text.slice(sectionFrom, sectionTo));
  const moved =
    insertAt < sectionFrom
      ? endWithBlankLine(text.slice(0, insertAt)) +
        section +
        text.slice(insertAt, sectionFrom) +
        text.slice(sectionTo)
      : text.slice(0, sectionFrom) +
        endWithBlankLine(text.slice(sectionTo, insertAt)) +
        section +
        text.slice(insertAt);
  return smallestEdit(text, moved);
}

/**
 * `text` ending in a blank line, unless it is empty: a section moved to the
 * top of a note does not start with blank lines.
 */
function endWithBlankLine(text: string): string {
  if (text === "" || text.endsWith("\n\n")) {
    return text;
  }
  return text.endsWith("\n") ? `${text}\n` : `${text}\n\n`;
}

/**
 * One replacement turning `before` into `after`, leaving the common start and
 * end untouched so the editor keeps folds, marks and the caret outside it.
 */
function smallestEdit(before: string, after: string): TextEdit | undefined {
  if (before === after) {
    return undefined;
  }
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before[start] === after[start]) {
    start++;
  }
  let end = 0;
  while (
    end < shorter - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}
