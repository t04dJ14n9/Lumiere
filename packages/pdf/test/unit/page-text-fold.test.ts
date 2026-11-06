import assert from "node:assert/strict";
import { test } from "node:test";
import { foldText, rawRangeOf } from "../../src/shared/page-text-fold";

test("foldText lower-cases and collapses every whitespace run to one space", () => {
  const folded = foldText("  Hello \r\n\tWORLD  again \n");
  assert.equal(folded.text, "hello world again");
});

test("foldText drops characters that carry no text", () => {
  assert.equal(foldText("co­op​⁠﻿era￾tion").text, "cooperation");
  // Whitespace around an invisible character is still one run.
  assert.equal(foldText("a ­ b").text, "a b");
});

test("foldText maps each folded character to where it starts in the raw text", () => {
  const raw = "ab \r\n cd";
  const folded = foldText(raw);
  assert.equal(folded.text, "ab cd");
  // The space is where the whitespace run begins.
  assert.deepEqual(folded.rawIndex, [0, 1, 2, 6, 7]);
});

test("a character that lower-cases to several units is mapped to its start", () => {
  const folded = foldText("İx");
  assert.equal(folded.text.length, 3);
  assert.deepEqual(folded.rawIndex, [0, 0, 1]);
});

test("rawRangeOf ends the range after the last character's whole code point", () => {
  const folded = foldText("a \u{1f600} b");
  assert.equal(folded.text, "a \u{1f600} b");
  // Folded [0, 4) is "a" + " " + both units of the emoji.
  assert.deepEqual(rawRangeOf(folded, 0, 4), { start: 0, end: 4 });
  assert.deepEqual(rawRangeOf(folded, 5, 6), { start: 5, end: 6 });
});
