/**
 * Whether `text` ends inside an Obsidian `%%` comment: a `%%` opened in it
 * has no closing `%%` after it. Shared by the editor's parser and the
 * reading view's, so they agree on where a paragraph ends.
 *
 * Read as the inline parsers read it: a `%%` inside a code span, or right
 * after a backslash escape (`\%%` is a `%` and a `%`), is text. Inside a
 * comment only the next `%%` counts.
 */
export function hasOpenComment(text: string): boolean {
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (char === "\\" && ESCAPABLE.test(text[at + 1] ?? "")) {
      at += 2;
    } else if (char === "`") {
      at = afterCodeSpan(text, at);
    } else if (text.startsWith("%%", at)) {
      const close = text.indexOf("%%", at + 2);
      if (close < 0) {
        return true;
      }
      at = close + 2;
    } else {
      at++;
    }
  }
  return false;
}

/** ASCII punctuation, which a backslash escapes (CommonMark). */
const ESCAPABLE = /^[!-/:-@[-`{-~]$/;

/**
 * Where scanning goes on after the backtick run at `at`: past its code span
 * when a run of the same length closes it, else past the run, which is text.
 */
function afterCodeSpan(text: string, at: number): number {
  let end = at;
  while (text[end] === "`") {
    end++;
  }
  const run = text.slice(at, end);
  for (let next = text.indexOf(run, end); next >= 0;) {
    let after = next + run.length;
    if (text[after] !== "`") {
      return after;
    }
    while (text[after] === "`") {
      after++;
    }
    next = text.indexOf(run, after);
  }
  return end;
}
