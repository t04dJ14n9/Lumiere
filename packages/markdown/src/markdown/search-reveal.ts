/** An inclusive span in the note's text. */
export interface TextRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Obsidian reveals source syntax at a search match, not only at the caret
 * (DESIGN.md §11.3). Live Preview hides syntax everywhere `revealed()` says it
 * may, so the match ranges must join the existing reveal ranges. Coalescing
 * overlaps keeps one decoration span per contiguous region instead of a
 * decoration per match, which matters when a search hits every line.
 *
 * Pure: no EditorState, DOM or VS Code. The follow-up commit wires a
 * StateField that the search plugin updates into `revealRanges()`.
 */
export function revealRangesWithMatches(
  reveal: readonly TextRange[],
  matches: readonly TextRange[],
): TextRange[] {
  const ordered = [...reveal, ...matches]
    .map((range) => ({
      from: Math.min(range.from, range.to),
      to: Math.max(range.from, range.to),
    }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: TextRange[] = [];
  for (const range of ordered) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      merged[merged.length - 1] = {
        from: last.from,
        to: Math.max(last.to, range.to),
      };
    } else {
      merged.push({ from: range.from, to: range.to });
    }
  }
  return merged;
}
