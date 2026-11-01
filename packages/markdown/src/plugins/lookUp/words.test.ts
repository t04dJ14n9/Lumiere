import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LOOK_UP_LENGTH,
  coreWord,
  isLookUpPlatform,
  isLookUpWord,
  lookUpUrl,
  selectedWord,
  wordAround,
} from "./words";

test("a word loses the punctuation around it and keeps apostrophes and hyphens inside", () => {
  assert.equal(coreWord("“Hello,”"), "Hello");
  assert.equal(coreWord("(see)"), "see");
  assert.equal(coreWord("don’t."), "don’t");
  assert.equal(coreWord("state-of-the-art!"), "state-of-the-art");
  assert.equal(coreWord("  café "), "café");
  assert.equal(coreWord("café"), "café", "normalized to NFC");
});

test("text with no letters or digits, or too long for a word, is no word", () => {
  assert.equal(coreWord("—"), "");
  assert.equal(coreWord("  "), "");
  assert.equal(coreWord("**"), "");
  assert.equal(coreWord("a".repeat(MAX_LOOK_UP_LENGTH)).length, 100);
  assert.equal(coreWord("a".repeat(MAX_LOOK_UP_LENGTH + 1)), "");
});

test("a selection counts only when it is one word", () => {
  assert.equal(selectedWord("serendipity"), "serendipity");
  assert.equal(selectedWord(" serendipity, "), "serendipity");
  assert.equal(selectedWord("**bold**"), "bold");
  assert.equal(selectedWord("two words"), "");
  assert.equal(selectedWord("one\nline"), "");
  assert.equal(selectedWord(""), "");
  assert.equal(selectedWord("..."), "");
});

test("the word around a character follows Unicode word boundaries", () => {
  const text = "Hello, don’t (see) state-of-the-art 3.14!";
  assert.equal(wordAround(text, 0), "Hello");
  assert.equal(wordAround(text, 4), "Hello");
  assert.equal(wordAround(text, text.indexOf("’")), "don’t");
  assert.equal(wordAround(text, text.indexOf("see") + 1), "see");
  assert.equal(wordAround(text, text.indexOf("of")), "of");
  assert.equal(wordAround(text, text.indexOf("3.14") + 2), "3.14");
});

test("spaces, punctuation and positions outside the text are no word", () => {
  const text = "Hello, world";
  assert.equal(wordAround(text, text.indexOf(",")), "");
  assert.equal(wordAround(text, text.indexOf(" ")), "");
  assert.equal(wordAround(text, -1), "");
  assert.equal(wordAround(text, text.length), "");
  assert.equal(wordAround("", 0), "");
});

test("Chinese and Japanese text splits into words instead of running to the next space", () => {
  const word = wordAround("日本語の文章です", 1);
  assert.ok(word.length > 0 && word.length < "日本語の文章です".length, word);
  assert.ok("日本語の文章です".startsWith(word), word);
});

test("the host takes one word of at most 100 characters, with no control characters", () => {
  assert.equal(isLookUpWord("word"), true);
  assert.equal(isLookUpWord("don’t"), true);
  assert.equal(isLookUpWord("a".repeat(MAX_LOOK_UP_LENGTH)), true);
  assert.equal(isLookUpWord("a".repeat(MAX_LOOK_UP_LENGTH + 1)), false);
  assert.equal(isLookUpWord(""), false);
  assert.equal(isLookUpWord("two\nlines"), false);
  assert.equal(isLookUpWord("tab\there"), false);
  assert.equal(isLookUpWord("bell\u0007"), false);
  assert.equal(isLookUpWord("del\u007f"), false);
  assert.equal(isLookUpWord(42), false);
  assert.equal(isLookUpWord(undefined), false);
});

test("the Dictionary URL encodes the word, so nothing in it can change the URL", () => {
  assert.equal(lookUpUrl("word"), "dict://word");
  assert.equal(lookUpUrl("café"), "dict://caf%C3%A9");
  assert.equal(lookUpUrl("a/b?c#d"), "dict://a%2Fb%3Fc%23d");
  assert.equal(lookUpUrl("x@evil:1"), "dict://x%40evil%3A1");
});

test("only macOS has the Dictionary app to open", () => {
  assert.equal(isLookUpPlatform("darwin"), true);
  for (const platform of ["linux", "win32", "freebsd", ""]) {
    assert.equal(isLookUpPlatform(platform), false, platform);
  }
});
