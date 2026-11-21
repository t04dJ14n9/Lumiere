/**
 * Accent folding for fuzzy matching, as Obsidian 1.15.0 folds its
 * suggestions and quick switcher: `cafe` finds `café`, and `café` finds
 * `cafe` a little lower than `café`.
 *
 * A Latin or Greek letter, or Cyrillic `ё`, between U+00C0 and U+212B folds
 * to its canonical decomposition without the combining marks U+0300–U+036F
 * (`é` → `e`, `Å` → `A`); the marks themselves fold to nothing, so a
 * decomposed `é` folds as `é` does. Anything else is kept as written:
 * a ligature such as `ﬃ` stays its own text.
 */

const COMBINING_MARKS = /[̀-ͯ]/gu;
const COMBINING_MARK = /^[̀-ͯ]$/u;
/** Letters that fold: Latin and Greek, and Cyrillic `Ё`/`ё` only. */
const FOLDING_LETTER = /^(?:[Ёё]|(?=\p{L})[\p{sc=Latin}\p{sc=Greek}])$/u;
/** A quick test for text with nothing to fold, the common case. */
const MAY_FOLD = /[À-Å]/u;
const FIRST = 0xc0;
const LAST = 0x212b;

const folds = new Map<string, string>();

/** One UTF-16 unit folded: itself, its bare letters, or nothing for a mark. */
function foldedChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code < FIRST || code > LAST) {
    return char;
  }
  let folded = folds.get(char);
  if (folded === undefined) {
    folded = foldOf(char);
    folds.set(char, folded);
  }
  return folded;
}

function foldOf(char: string): string {
  if (COMBINING_MARK.test(char)) {
    return "";
  }
  if (!FOLDING_LETTER.test(char)) {
    return char;
  }
  const decomposed = char.normalize("NFD");
  const bare = decomposed.replace(COMBINING_MARKS, "");
  return bare === decomposed ? char : bare;
}

/** `text` with its accents folded, case kept. */
export function foldAccents(text: string): string {
  if (!MAY_FOLD.test(text)) {
    return text;
  }
  let folded = "";
  for (const unit of text.split("")) {
    folded += foldedChar(unit);
  }
  return folded;
}

/**
 * Folded text that remembers where each of its characters came from, so
 * ranges matched in it can be given back in the text as written.
 */
export interface FoldedText {
  text: string;
  /** For each position of `text`, where its character starts in the original. */
  starts: number[];
  /**
   * For each position of `text`, where its character ends in the original,
   * past any combining marks that followed it there.
   */
  ends: number[];
}

/** `text` folded with its positions, or undefined when nothing folds. */
export function foldWithPositions(text: string): FoldedText | undefined {
  if (!MAY_FOLD.test(text)) {
    return undefined;
  }
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let at = 0; at < text.length; at++) {
    const piece = foldedChar(text[at]!);
    if (piece === "") {
      // A dropped mark belongs to the letter just before it.
      for (let last = ends.length - 1; ends[last] === at; last--) {
        ends[last] = at + 1;
      }
      continue;
    }
    for (const unit of piece) {
      folded += unit;
      starts.push(at);
      ends.push(at + 1);
    }
  }
  return folded === text ? undefined : { text: folded, starts, ends };
}

/** Ranges of the folded text as ranges of the original, merged where they meet. */
export function originalRanges(
  folded: FoldedText,
  ranges: readonly [number, number][],
): [number, number][] {
  const mapped: [number, number][] = [];
  for (const [from, to] of ranges) {
    const start = folded.starts[from]!;
    const end = folded.ends[to - 1]!;
    const previous = mapped.at(-1);
    if (previous && previous[1] >= start) {
      previous[1] = Math.max(previous[1], end);
    } else {
      mapped.push([start, end]);
    }
  }
  return mapped;
}

/**
 * The query's words that carry an accent, lower-cased. A match that does not
 * contain each of them as written ranks a little lower than one that does.
 */
export function accentedWords(query: string): string[] {
  return query
    .normalize("NFC")
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "" && foldAccents(word) !== word);
}

/** Whether the matched text, joined, holds every accented word as written. */
export function keepsAccents(
  text: string,
  ranges: readonly [number, number][],
  words: readonly string[],
): boolean {
  const matched = ranges
    .map(([from, to]) => text.slice(from, to))
    .join("")
    .normalize("NFC")
    .toLowerCase();
  return words.every((word) => matched.includes(word));
}
