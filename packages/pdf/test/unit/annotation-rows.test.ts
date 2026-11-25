import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationRows,
  isListedMark,
  noteExcerpt,
  oneLine,
  rowTooltip,
  shortCreated,
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

test("a mark keeps when it was made; a missing or broken date is left out", () => {
  const [made, unknown, broken] = annotationRows([
    mark("a", "highlight", 1, 0, { createdAt: "2026-11-20T07:29:25Z" }),
    mark("b", "highlight", 1, 1, { createdAt: null }),
    mark("c", "highlight", 1, 2, { createdAt: "not a date" }),
  ]);
  assert.equal(made!.createdAt, "2026-11-20T07:29:25Z");
  assert.equal("createdAt" in unknown!, false);
  assert.equal("createdAt" in broken!, false);
});

test("the tooltip says when the mark was made, after its kind and page", () => {
  const [row] = annotationRows([
    mark("a", "highlight", 4, 0, { createdAt: "2026-11-20T07:29:25Z" }),
  ]);
  const when = new Date("2026-11-20T07:29:25Z").toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  assert.equal(
    rowTooltip(row!, "The words", null, "en-US"),
    `Highlight, page 4\nCreated ${when}\nThe words`,
  );
});

test("the row shows the time for today, the day this year, the full date before", () => {
  const now = new Date(2026, 10, 25, 18, 0);
  const today = new Date(2026, 10, 25, 9, 5).toISOString();
  const thisYear = new Date(2026, 2, 3, 9, 5).toISOString();
  const lastYear = new Date(2025, 2, 3, 9, 5).toISOString();
  assert.equal(shortCreated(today, now, "en-US"), "09:05 AM");
  assert.equal(shortCreated(thisYear, now, "en-US"), "Mar 3");
  assert.equal(shortCreated(lastYear, now, "en-US"), "Mar 3, 2025");
});
