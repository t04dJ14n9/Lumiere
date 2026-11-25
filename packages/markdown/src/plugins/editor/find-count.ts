import type { EditorState, Text } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";
import { t } from "@workshop/l10n";

/** Counting stops here so a one-letter query in a huge note stays cheap. */
export const countLimit = 1000;

export interface MatchCount {
  /** 1-based index of the selected match, or 0 when no match is selected. */
  current: number;
  total: number;
  /** True when the note has more matches than were counted. */
  capped: boolean;
}

/**
 * The first `countLimit` matches of `query` in `doc`. A caret move asks
 * which one is selected without searching the note again.
 */
export interface FoundMatches {
  doc: Text;
  query: SearchQuery;
  ranges: readonly { from: number; to: number }[];
  capped: boolean;
}

export function findMatches(
  state: EditorState,
  query: SearchQuery,
): FoundMatches {
  const ranges: { from: number; to: number }[] = [];
  const found = { doc: state.doc, query, ranges, capped: false };
  if (!query.valid) {
    return found;
  }
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (ranges.length === countLimit) {
      found.capped = true;
      break;
    }
    ranges.push({ from: next.value.from, to: next.value.to });
  }
  return found;
}

/** Whether `found` still holds the matches of `query` in `state`. */
export function stillFound(
  found: FoundMatches | undefined,
  state: EditorState,
  query: SearchQuery,
): found is FoundMatches {
  return Boolean(found && found.doc === state.doc && found.query.eq(query));
}

/** Which of the found matches `selection` is on, by binary search. */
export function selectedMatch(
  found: FoundMatches,
  selection: { from: number; to: number },
): MatchCount {
  const { ranges, capped } = found;
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle]!.from < selection.from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  // Matches never overlap, so at most one starts where the selection does.
  const match = ranges[low];
  const current =
    match && match.from === selection.from && match.to === selection.to
      ? low + 1
      : 0;
  return { current, total: ranges.length, capped };
}

/** Counts `query`'s matches and finds which one the main selection is on. */
export function countMatches(
  state: EditorState,
  query: SearchQuery,
): MatchCount {
  return selectedMatch(findMatches(state, query), state.selection.main);
}

/** Text shown beside the find field, as in Obsidian's find bar. */
export function countLabel(query: SearchQuery, count: MatchCount): string {
  if (!query.search) {
    return "";
  }
  if (count.total === 0) {
    return t("No results");
  }
  const total = count.capped ? `${countLimit}+` : String(count.total);
  return count.current
    ? `${count.current} / ${total}`
    : t("{0} results", total);
}
