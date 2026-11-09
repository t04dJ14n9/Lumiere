/**
 * Page text folded for matching, the way Chrome matches a text fragment:
 * case and whitespace differences do not matter. A page's text has a line
 * break between its lines, while the quote a link carries was joined with
 * single spaces when it was copied, so neither side can be compared as it is.
 */

/** Characters that carry no text: they vanish from the folded text. */
const INVISIBLE = new Set([
  "­", // soft hyphen
  "​", // zero-width space
  "⁠", // word joiner
  "﻿", // byte order mark
  "￾",
  "￿",
]);

const WHITESPACE = /\s/u;

/** Characters [start, end) of a text. */
export interface TextRange {
  start: number;
  end: number;
}

export interface FoldedText {
  /** The raw text this was folded from. */
  readonly raw: string;
  /**
   * Lower case, with each run of whitespace one space and no space at either
   * end. Its length differs from the raw text's.
   */
  readonly text: string;
  /** `rawIndex[i]` is where folded character `i` starts in the raw text. */
  readonly rawIndex: readonly number[];
}

/**
 * Fold `raw` for matching. A whitespace run is mapped to where it starts,
 * and a lower-cased character that grows into several is mapped to where it
 * started, so a match can always be traced back to the characters it covers.
 */
export function foldText(raw: string): FoldedText {
  let text = "";
  const rawIndex: number[] = [];
  let spaceAt: number | undefined;
  let offset = 0;
  for (const char of raw) {
    const at = offset;
    offset += char.length;
    if (INVISIBLE.has(char)) {
      continue;
    }
    if (WHITESPACE.test(char)) {
      spaceAt ??= at;
      continue;
    }
    // A space is only emitted once the next real character shows it is not
    // trailing, so the folded text never starts or ends with one.
    if (spaceAt !== undefined && text) {
      text += " ";
      rawIndex.push(spaceAt);
    }
    spaceAt = undefined;
    const lower = char.toLowerCase();
    text += lower;
    for (let unit = 0; unit < lower.length; unit++) {
      rawIndex.push(at);
    }
  }
  return { raw, text, rawIndex };
}

/**
 * The raw characters [start, end) a folded range covers: from the first
 * folded character's start to the end of the last one's character.
 */
export function rawRangeOf(
  folded: FoldedText,
  start: number,
  end: number,
): TextRange {
  const first = folded.rawIndex[start] ?? 0;
  const last = folded.rawIndex[end - 1] ?? first;
  const lastLength = (folded.raw.codePointAt(last) ?? 0) > 0xffff ? 2 : 1;
  return { start: first, end: last + lastLength };
}
