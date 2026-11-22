import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookmarkStoreName,
  BOOKMARK_FILE_VERSION,
  defaultBookmarkTitle,
  MAX_BOOKMARK_TITLE_LENGTH,
  parseBookmark,
  parseBookmarkFile,
  serializeBookmarkFile,
  sortBookmarks,
  validateBookmarkTitle,
  withBookmark,
  withoutBookmark,
  withRenamedBookmark,
  type Bookmark,
} from "../../src/shared/bookmarks";
import type { OutlineItem } from "../../src/shared/messages";

const SHA = "ab".repeat(32);
const mark = (
  id: string,
  page: number,
  top = 0,
  extra: Partial<Bookmark> = {},
): Bookmark => ({
  id,
  title: `Mark ${id}`,
  page,
  position: { top, left: 0 },
  created: "2026-11-22T08:00:00.000Z",
  ...extra,
});

test("the file is named by the PDF's hash, beside its annotation file", () => {
  assert.equal(bookmarkStoreName(SHA), `${SHA}.bookmarks.json`);
  assert.throws(() => bookmarkStoreName("../x"), /Not a SHA-256/u);
  assert.throws(() => bookmarkStoreName(SHA.toUpperCase()), /Not a SHA-256/u);
});

test("the file is versioned JSON in page order, and an empty list is no file", () => {
  assert.equal(serializeBookmarkFile([]), undefined);
  const text = serializeBookmarkFile([mark("b", 9, 40), mark("a", 2, 10)])!;
  assert.ok(text.endsWith("\n"));
  const file = JSON.parse(text) as { version: number; bookmarks: Bookmark[] };
  assert.equal(file.version, BOOKMARK_FILE_VERSION);
  assert.equal(BOOKMARK_FILE_VERSION, 1);
  assert.deepEqual(
    file.bookmarks.map((bookmark) => bookmark.id),
    ["a", "b"],
  );
  assert.deepEqual(Object.keys(file.bookmarks[0]!), [
    "id",
    "title",
    "page",
    "position",
    "created",
  ]);
});

test("what is written is read back", () => {
  const written = [mark("b", 9, 40), mark("a", 2, 10)];
  assert.deepEqual(
    parseBookmarkFile(serializeBookmarkFile(written)!),
    sortBookmarks(written),
  );
});

test("bookmarks sort by page, then position on the page, then age", () => {
  const sorted = sortBookmarks([
    mark("late", 5, 0, { created: "2026-11-23T00:00:00.000Z" }),
    mark("low", 5, 300),
    mark("early", 5, 0),
    mark("right", 5, 300, { position: { top: 300, left: 50 } }),
    mark("first", 1),
  ]);
  assert.deepEqual(
    sorted.map((bookmark) => bookmark.id),
    ["first", "early", "late", "low", "right"],
  );
});

test("a file from a newer Lumiere, or one that is not a bookmark file, is refused rather than overwritten", () => {
  assert.throws(
    () => parseBookmarkFile(JSON.stringify({ version: 2, bookmarks: [] })),
    /newer version of Lumiere/u,
  );
  assert.throws(() => parseBookmarkFile("{not json"), /not a bookmark file/u);
  assert.throws(() => parseBookmarkFile("[]"), /not a bookmark file/u);
  assert.throws(
    () => parseBookmarkFile(JSON.stringify({ version: 1 })),
    /not a bookmark file/u,
  );
});

test("an entry that is not a bookmark is skipped; the others stay", () => {
  const good = mark("good", 3, 12);
  const text = JSON.stringify({
    version: 1,
    bookmarks: [
      good,
      mark("dup", 4),
      { ...mark("dup", 8) },
      { ...mark("zero", 0) },
      { ...mark("negative", 1, -5) },
      { ...mark("untitled", 1, 0, { title: "   " }) },
      { ...mark("long", 1, 0, { title: "x".repeat(300) }) },
      { ...mark("badDate", 1, 0, { created: "yesterday" }) },
      { ...mark("", 1) },
      "text",
      null,
    ],
  });
  assert.deepEqual(
    parseBookmarkFile(text).map((bookmark) => bookmark.id),
    ["good", "dup"],
  );
  assert.deepEqual(parseBookmark({ ...good, extra: true }), good);
});

test("a title is trimmed, and must have something in it", () => {
  assert.equal(validateBookmarkTitle("Methods"), undefined);
  assert.match(validateBookmarkTitle("   ") ?? "", /Enter a title/u);
  assert.match(validateBookmarkTitle("") ?? "", /Enter a title/u);
  assert.equal(
    validateBookmarkTitle("x".repeat(MAX_BOOKMARK_TITLE_LENGTH)),
    undefined,
  );
  assert.match(
    validateBookmarkTitle("x".repeat(MAX_BOOKMARK_TITLE_LENGTH + 1)) ?? "",
    /at most 200 characters/u,
  );
});

test("a bookmark is added, renamed and removed by its id", () => {
  const list = [mark("a", 1), mark("b", 2)];
  assert.deepEqual(
    withBookmark(list, mark("c", 3)).map((bookmark) => bookmark.id),
    ["a", "b", "c"],
  );
  // A repeat of the same add (a retried save) changes nothing.
  assert.deepEqual(withBookmark(list, mark("a", 9)), list);
  assert.equal(
    withRenamedBookmark(list, "b", "  Results ")[1]?.title,
    "Results",
  );
  assert.deepEqual(withRenamedBookmark(list, "gone", "x"), list);
  assert.deepEqual(withoutBookmark(list, "a"), [mark("b", 2)]);
  assert.deepEqual(withoutBookmark(list, "gone"), list);
  // The lists given are never changed.
  assert.equal(list.length, 2);
  assert.equal(list[1]?.title, "Mark b");
});

const outline: OutlineItem[] = [
  {
    title: "Part One",
    page: 1,
    top: 0,
    children: [
      { title: "Section 1.1", page: 2, top: 0, children: [] },
      { title: "Section 1.2", page: 3, top: 100, children: [] },
    ],
  },
  { title: "Part Two", page: 9, children: [] },
];

test("the default title is the outline section the place is in, else Page N", () => {
  assert.equal(
    defaultBookmarkTitle(outline, { page: 2, top: 50 }),
    "Section 1.1",
  );
  // The deepest section reached, not its part.
  assert.equal(
    defaultBookmarkTitle(outline, { page: 4, top: 0 }),
    "Section 1.2",
  );
  // On the section's page, above where the section starts: still the one before.
  assert.equal(
    defaultBookmarkTitle(outline, { page: 3, top: 40 }),
    "Section 1.1",
  );
  assert.equal(defaultBookmarkTitle(outline, { page: 9, top: 0 }), "Part Two");
  assert.equal(defaultBookmarkTitle([], { page: 4, top: 0 }), "Page 4");
  // The outline is still being read.
  assert.equal(defaultBookmarkTitle(undefined, { page: 4, top: 0 }), "Page 4");
  const before: OutlineItem[] = [{ title: "Intro", page: 5, children: [] }];
  assert.equal(defaultBookmarkTitle(before, { page: 2, top: 0 }), "Page 2");
});

test("a section title too long for a bookmark falls back to the page", () => {
  const long: OutlineItem[] = [
    { title: "x".repeat(300), page: 1, children: [] },
  ];
  assert.equal(defaultBookmarkTitle(long, { page: 3, top: 0 }), "Page 3");
});
