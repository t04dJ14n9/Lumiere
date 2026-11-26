import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseCss = readFileSync(
  new URL("../../../src/webview/styles/base.css", import.meta.url),
  "utf8",
);

/** The declarations of a rule, by its exact selector list. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is styled`);
  return css.slice(start, css.indexOf("}", start));
}

// CodeMirror's `posAtCoords` reads a widget rectangle that lies above the
// pointer as "the target is further along". A hidden heading mark is an empty
// widget, so if its box is zero tall at the line's top edge it is always above
// the pointer: every point on a heading with hidden inline marks answered the
// last mark, and a double or Shift click selected from there.
const hiddenMark = rule(
  baseCss,
  "#app .cm-line.md-heading > span:empty,\n#app .cm-line.md-heading .cm-widgetBuffer",
);

test("a hidden heading mark's box is as tall as the line, so the pointer can overlap it", () => {
  assert.match(hiddenMark, /height:\s*1lh\s*;/);
  assert.doesNotMatch(hiddenMark, /(?<![-\w])height:\s*0\s*;/);
  // `1lh` is the line-height of the box itself: zeroed, it would be 0 again.
  assert.doesNotMatch(hiddenMark, /(?<!-)line-height:\s*0\s*;/);
  assert.doesNotMatch(hiddenMark, /font-size:\s*0\s*;/);
});

test("a hidden heading mark still adds nothing to the line's height", () => {
  assert.match(hiddenMark, /display:\s*inline-block\s*;/);
  assert.match(hiddenMark, /vertical-align:\s*top\s*;/);
  // The margin box is zero tall, so the line box does not grow (a revealed
  // marker and a hidden one lay the heading out alike).
  assert.match(hiddenMark, /margin-bottom:\s*-1lh\s*;/);
});
