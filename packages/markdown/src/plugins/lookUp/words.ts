/**
 * macOS Look Up for notes: which word the reader means, and how it reaches
 * the Dictionary app. Pure helpers: the webview finds the text under the
 * pointer (pointer-word.ts), the host opens the URL (host.ts). Lumiere PDF
 * keeps its own copy (packages/pdf/src/shared/look-up.ts), since one
 * product never imports the other's internals.
 */

/** Longest word sent to the dictionary; anything longer is not a word. */
export const MAX_LOOK_UP_LENGTH = 100;

/**
 * The word inside `text`: surrounding punctuation and spaces are dropped,
 * apostrophes and hyphens inside it stay ("don’t", "state-of-the-art").
 * Empty when there are no letters or digits, or when it is too long.
 */
export function coreWord(text: string): string {
  const word = text
    .normalize("NFC")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return /[\p{L}\p{N}]/u.test(word) && word.length <= MAX_LOOK_UP_LENGTH
    ? word
    : "";
}

/**
 * The selected text as a word to look up, or "" when it is a phrase, a
 * passage or punctuation. On macOS a secondary click selects the word under
 * the pointer before the menu opens, so this is usually that word.
 */
export function selectedWord(text: string): string {
  const word = coreWord(text);
  return /\s/u.test(word) ? "" : word;
}

/**
 * The word of `text` that contains the character at `index`, by Unicode word
 * boundaries (the ones Chromium and macOS select by): "don’t" stays whole,
 * "word," loses its comma, and Chinese or Japanese text splits into words
 * rather than running to the next space. Empty when that character belongs
 * to no word (a space, a hyphen, punctuation).
 */
export function wordAround(text: string, index: number): string {
  if (index < 0 || index >= text.length) {
    return "";
  }
  const segments = new Intl.Segmenter(undefined, { granularity: "word" });
  const segment = segments.segment(text).containing(index);
  return segment?.isWordLike ? coreWord(segment.segment) : "";
}

/** Whether a message from the webview carries a word the host may look up. */
export function isLookUpWord(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_LOOK_UP_LENGTH &&
    // One word: no control characters, line breaks or tabs.
    !/\p{Cc}/u.test(value)
  );
}

/** The Dictionary app's URL for a word: it opens the app at the entry. */
export function lookUpUrl(word: string): string {
  return `dict://${encodeURIComponent(word)}`;
}

/** Whether Look Up can open the Dictionary app here: macOS only. */
export function isLookUpPlatform(platform: string): boolean {
  return platform === "darwin";
}
