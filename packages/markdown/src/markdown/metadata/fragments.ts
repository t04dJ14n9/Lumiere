import { metadata } from "./index";
import type { NoteMetadata } from "./types";
export interface SourceRange {
  from: number;
  to: number;
  text: string;
}

type HeadingEntry = NoteMetadata["headings"][number];

export function noteFragment(
  source: string,
  fragment: string,
): SourceRange | undefined {
  if (!fragment) {
    return { from: 0, to: source.length, text: source };
  }
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    return undefined;
  }
  const note = metadata(source);
  if (fragment.startsWith("^")) {
    // Obsidian compares block ids without case.
    const id = fragment.slice(1).toLowerCase();
    const block = Object.values(note.blocks).find(
      (candidate) => candidate.id.toLowerCase() === id,
    );
    return block
      ? { from: block.from, to: block.to, text: block.text }
      : undefined;
  }
  const headings = note.headings;
  const heading =
    obsidianHeading(headings, fragment) ?? githubHeading(headings, fragment);
  if (!heading) {
    return undefined;
  }
  const end =
    headings
      .slice(headings.indexOf(heading) + 1)
      .find((next) => next.level <= heading.level)?.from ?? source.length;
  return { from: heading.from, to: end, text: source.slice(heading.from, end) };
}

/** Characters Obsidian reads as a space when it compares heading text. */
const OBSIDIAN_SEPARATORS = /[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g;

const obsidianKey = (text: string): string =>
  text
    .replace(OBSIDIAN_SEPARATORS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Obsidian's `resolveSubpath`: each part matches the next heading deeper than
 * the previous match, compared as text without case or punctuation. Like
 * Obsidian, a part's section is not a bound: in `# Top`, `# Other`, `## Deep`,
 * `Top#Deep` reaches the `## Deep` under `Other` (only the last match ends at
 * the next heading of its level or higher).
 */
function obsidianHeading(
  headings: readonly HeadingEntry[],
  fragment: string,
): HeadingEntry | undefined {
  const parts = fragment.split("#").filter(Boolean).map(obsidianKey);
  if (parts.length === 0) {
    return undefined;
  }
  let matched = 0;
  let level = 0;
  for (const heading of headings) {
    if (
      heading.level > level &&
      obsidianKey(heading.heading) === parts[matched]
    ) {
      matched++;
      level = heading.level;
      if (matched === parts.length) {
        return heading;
      }
    }
  }
  return undefined;
}

/**
 * The anchor GitHub (and VS Code's Markdown) gives a heading: lower case,
 * punctuation dropped, each space a hyphen. Repeats get `-1`, `-2`, ….
 */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** A single `#slug` as GitHub writes it, for links written for GitHub or VS Code. */
function githubHeading(
  headings: readonly HeadingEntry[],
  fragment: string,
): HeadingEntry | undefined {
  if (fragment.includes("#")) {
    return undefined;
  }
  const wanted = fragment.toLowerCase();
  const seen = new Map<string, number>();
  for (const heading of headings) {
    const base = githubSlug(heading.heading.trim());
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if ((count ? `${base}-${count}` : base) === wanted) {
      return heading;
    }
  }
  return undefined;
}
