import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationRows,
  isListedMark,
  noteExcerpt,
  oneLine,
  rowTooltip,
  swatchColor,
  type MarkInput,
} from "../../src/shared/annotation-rows";

const mark = (
  key: string,
  subtype: string,
  page: number,
  top = 0,
  extra: Partial<MarkInput> = {},
): MarkInput => ({ key, subtype, page, top, left: 0, ...extra });

test("the reader's marks are listed; links, popups and form fields are not", () => {
  for (const kind of [
    "highlight",
    "underline",
    "strikeout",
    "squiggly",
    "text",
    "ink",
    "stamp",
  ]) {
    assert.equal(isListedMark(kind), true, kind);
  }
  for (const kind of [
    "link",
    "popup",
    "widget",
    "unsupported",
    "toString",
    "__proto__",
  ]) {
    assert.equal(isListedMark(kind), false, kind);
  }
});

test("rows come in reading order: page, then down the page, then across it", () => {
  const rows = annotationRows([
    mark("d", "highlight", 3, 10),
    mark("b", "underline", 1, 200),
    mark("link", "link", 1, 0),
    mark("c", "highlight", 1, 200, { left: 50 }),
    mark("a", "text", 1, 20),
  ]);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["a", "b", "c", "d"],
  );
});

test("a row has its kind's name and icon, and says whether it quotes the text under it", () => {
  const [highlight, note, drawing] = annotationRows([
    mark("1", "highlight", 1),
    mark("2", "text", 2),
    mark("3", "ink", 3),
  ]);
  assert.deepEqual(
    [highlight?.label, highlight?.icon, highlight?.quotesText],
    ["Highlight", "edit", true],
  );
  assert.deepEqual(
    [note?.label, note?.icon, note?.quotesText],
    ["Note", "note", false],
  );
  assert.deepEqual([drawing?.label, drawing?.quotesText], ["Drawing", false]);
});

test("a colour is a swatch only when it is a hex colour", () => {
  assert.equal(swatchColor("#FFE566"), "#FFE566");
  assert.equal(swatchColor("#fc0"), "#fc0");
  assert.equal(swatchColor("#ffe56680"), "#ffe56680");
  for (const bad of [
    "red",
    "rgb(1,2,3)",
    "#12",
    "#ggg",
    "url(x)",
    5,
    null,
    undefined,
  ]) {
    assert.equal(swatchColor(bad), undefined, String(bad));
  }
  const [row] = annotationRows([
    mark("1", "highlight", 1, 0, { color: "javascript:1" }),
  ]);
  assert.equal(row?.color, undefined);
});

test("a note is one line of at most 80 characters; blank is none", () => {
  assert.equal(noteExcerpt("  Check this\n\nlater  "), "Check this later");
  assert.equal(noteExcerpt("   \n "), undefined);
  assert.equal(noteExcerpt(null), undefined);
  assert.equal(noteExcerpt(42), undefined);
  const long = noteExcerpt("word ".repeat(40));
  assert.equal(long?.length, 80);
  assert.ok(long?.endsWith("…"));
  assert.equal(oneLine("short", 10), "short");
  assert.equal(oneLine("exactly ten", 11), "exactly ten");
});

test("the tooltip says the kind and page, the quote, then the whole note", () => {
  const [row] = annotationRows([
    mark("1", "highlight", 4, 0, { contents: "A note\nin two lines" }),
  ]);
  assert.equal(
    rowTooltip(row!, "The marked words", "A note\nin two lines"),
    "Highlight, page 4\nThe marked words\nA note\nin two lines",
  );
  assert.equal(rowTooltip(row!, undefined, null), "Highlight, page 4");
});
