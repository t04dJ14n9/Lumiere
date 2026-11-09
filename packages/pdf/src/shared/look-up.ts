/**
 * macOS Look Up for the PDF viewer: which word is under the pointer, and how
 * it is handed to the system Dictionary. Pure helpers; the wiring is in
 * webview/look-up.ts (events) and extension/plugins/pdfLookUp (the lookup).
 */

/** Longest word sent to the dictionary; anything longer is not a word. */
export const MAX_LOOK_UP_LENGTH = 100;

/**
 * The word inside what was read from the PDF: surrounding punctuation is
 * dropped, apostrophes and hyphens inside it stay ("don’t", "state-of-the-art").
 * Empty when there are no letters or digits.
 */
export function coreWord(text: string): string {
  const word = text
    .normalize("NFC")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return /[\p{L}\p{N}]/u.test(word) && word.length <= MAX_LOOK_UP_LENGTH
    ? word
    : "";
}

/** Whether a message from the viewer carries a word the host may look up. */
export function isLookUpWord(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_LOOK_UP_LENGTH &&
    // eslint-disable-next-line no-control-regex -- one word: no control characters or line breaks
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/** The Dictionary app's URL for a word: it opens the app at the entry. */
export function lookUpUrl(word: string): string {
  return `dict://${encodeURIComponent(word)}`;
}

/** Whether Look Up applies: macOS only, and the setting on. */
export function lookUpEnabled(platform: string, setting: boolean): boolean {
  return platform === "darwin" && setting;
}
