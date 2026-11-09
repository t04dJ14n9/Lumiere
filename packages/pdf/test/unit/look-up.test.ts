import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreWord,
  isLookUpWord,
  lookUpEnabled,
  lookUpUrl,
} from "../../src/shared/look-up";

test("punctuation around a word is dropped, inside it stays", () => {
  assert.equal(coreWord("“Attention,”"), "Attention");
  assert.equal(coreWord("(don’t)"), "don’t");
  assert.equal(coreWord("state-of-the-art."), "state-of-the-art");
  assert.equal(coreWord("naïve"), "naïve");
  assert.equal(coreWord("注意力,"), "注意力");
  assert.equal(coreWord("3.14"), "3.14");
  assert.equal(coreWord("—"), "");
  assert.equal(coreWord("x".repeat(101)), "");
});

test("only a single plain word is accepted from the viewer", () => {
  assert.ok(isLookUpWord("attention"));
  assert.ok(!isLookUpWord(""));
  assert.ok(!isLookUpWord("two\nlines"));
  assert.ok(!isLookUpWord("x".repeat(101)));
  assert.ok(!isLookUpWord(42));
});

test("the Dictionary URL escapes the word", () => {
  assert.equal(lookUpUrl("attention"), "dict://attention");
  assert.equal(lookUpUrl("a b/c?d"), "dict://a%20b%2Fc%3Fd");
});

test("Look Up is for macOS with the setting on", () => {
  assert.ok(lookUpEnabled("darwin", true));
  assert.ok(!lookUpEnabled("darwin", false));
  assert.ok(!lookUpEnabled("linux", true));
  assert.ok(!lookUpEnabled("win32", true));
});
