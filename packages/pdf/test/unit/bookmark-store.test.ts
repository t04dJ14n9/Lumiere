import assert from "node:assert/strict";
import { test } from "node:test";
import type { PdfBookmarkFiles } from "../../src/shared/host";
import type { Bookmark } from "../../src/shared/bookmarks";
import {
  BookmarkStore,
  bookmarkFileOf,
} from "../../src/host/viewer/bookmark-store";

const SHA = "cd".repeat(32);
const FILE = { uri: "file:///vault/papers/a.pdf", sha256: SHA };
const KEY = `/vault/.lumiere/pdf-annotations/${SHA}.bookmarks.json`;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const mark = (id: string, page: number, title = `Mark ${id}`): Bookmark => ({
  id,
  title,
  page,
  position: { top: page * 10, left: 0 },
  created: "2026-11-22T08:00:00.000Z",
});

/**
 * One disk, and a way to be a window on it: each `window()` is the bookmark
 * files of one extension host. A watcher hears every write to the file,
 * whoever made it, as a real file watcher does.
 */
function disk() {
  const files = new Map<string, string>();
  const watchers = new Set<() => void>();
  const writes: Array<string | undefined> = [];
  const window = (): PdfBookmarkFiles => ({
    read: async (_uri, _sha) => files.get(KEY),
    write: async (_uri, _sha, text) => {
      writes.push(text);
      if (text === undefined) {
        files.delete(KEY);
      } else {
        files.set(KEY, text);
      }
      for (const watcher of [...watchers]) {
        watcher();
      }
    },
    key: () => KEY,
    watch: (_uri, _sha, onChange) => {
      watchers.add(onChange);
      return () => watchers.delete(onChange);
    },
  });
  return { files, writes, window, watchers };
}

const quiet = () => undefined;
const store = (files: PdfBookmarkFiles | undefined) =>
  new BookmarkStore(files, quiet);
const ids = (list: readonly Bookmark[]) => list.map((bookmark) => bookmark.id);

test("with no file there are no bookmarks", async () => {
  assert.deepEqual(await store(disk().window()).read(FILE), []);
});

test("a bookmark added is kept in the file for the PDF's hash, as versioned JSON", async () => {
  const d = disk();
  const bookmarks = store(d.window());
  await bookmarks.add(FILE, mark("a", 3));
  assert.deepEqual(await bookmarks.read(FILE), [mark("a", 3)]);
  const file = JSON.parse(d.files.get(KEY)!) as {
    version: number;
    bookmarks: Bookmark[];
  };
  assert.equal(file.version, 1);
  assert.deepEqual(file.bookmarks, [mark("a", 3)]);
});

test("a bookmark is renamed and removed by its id, and the last one removed leaves no file", async () => {
  const d = disk();
  const bookmarks = store(d.window());
  await bookmarks.add(FILE, mark("a", 3));
  await bookmarks.add(FILE, mark("b", 1));
  assert.deepEqual(ids(await bookmarks.read(FILE)), ["b", "a"]);
  await bookmarks.rename(FILE, "a", "Results");
  assert.equal((await bookmarks.read(FILE))[1]?.title, "Results");
  await bookmarks.remove(FILE, "b");
  assert.deepEqual(ids(await bookmarks.read(FILE)), ["a"]);
  await bookmarks.remove(FILE, "a");
  assert.equal(d.files.has(KEY), false);
  assert.equal(d.writes.at(-1), undefined);
});

test("a change that changes nothing writes nothing", async () => {
  const d = disk();
  const bookmarks = store(d.window());
  await bookmarks.add(FILE, mark("a", 3));
  const before = d.writes.length;
  await bookmarks.add(FILE, mark("a", 3));
  await bookmarks.rename(FILE, "gone", "x");
  await bookmarks.remove(FILE, "gone");
  assert.equal(d.writes.length, before);
});

test("saves made at once in one window are all kept", async () => {
  const bookmarks = store(disk().window());
  await Promise.all([
    bookmarks.add(FILE, mark("a", 1)),
    bookmarks.add(FILE, mark("b", 2)),
    bookmarks.add(FILE, mark("c", 3)),
  ]);
  assert.deepEqual(ids(await bookmarks.read(FILE)), ["a", "b", "c"]);
});

test("a save in one window is merged into what another window kept, by id", async () => {
  const d = disk();
  const first = store(d.window());
  const second = store(d.window());
  await first.add(FILE, mark("a", 1));
  await second.add(FILE, mark("b", 2));
  await first.add(FILE, mark("c", 3));
  // The second window's view is older than the file: its rename and delete
  // still find their bookmarks by id, and leave the ones it never saw.
  await second.rename(FILE, "a", "First");
  await second.remove(FILE, "c");
  assert.deepEqual(
    (await first.read(FILE)).map(({ id, title }) => [id, title]),
    [
      ["a", "First"],
      ["b", "Mark b"],
    ],
  );
});

test("another window's save is announced once, and this window's own save at once", async () => {
  const d = disk();
  const mine = store(d.window());
  const theirs = store(d.window());
  const heard: string[] = [];
  mine.onDidChange((key) => heard.push(key));
  const stop = mine.watch(FILE);
  await theirs.add(FILE, mark("a", 1));
  await tick();
  assert.deepEqual(heard, [KEY]);

  // Its own write is announced when it is made, not again by the watcher.
  await mine.add(FILE, mark("b", 2));
  await tick();
  assert.deepEqual(heard, [KEY, KEY]);

  stop();
  await theirs.add(FILE, mark("c", 3));
  await tick();
  assert.equal(heard.length, 2);
  assert.equal(d.watchers.size, 0, "stopping stops the file watcher");
});

test("a watcher event for a file that did not change announces nothing", async () => {
  const d = disk();
  const bookmarks = store(d.window());
  await bookmarks.add(FILE, mark("a", 1));
  const heard: string[] = [];
  bookmarks.onDidChange((key) => heard.push(key));
  const stop = bookmarks.watch(FILE);
  // A touch, or the echo of an atomic replace.
  for (const watcher of d.watchers) {
    watcher();
  }
  await tick();
  assert.deepEqual(heard, []);
  stop();
});

test("a file from a newer Lumiere is not read or written over, and says which file", async () => {
  const d = disk();
  const text = JSON.stringify({ version: 2, bookmarks: [] });
  d.files.set(KEY, text);
  const bookmarks = store(d.window());
  await assert.rejects(
    bookmarks.read(FILE),
    new RegExp(`${KEY}.*newer version of Lumiere`, "u"),
  );
  await assert.rejects(
    bookmarks.add(FILE, mark("a", 1)),
    /newer version of Lumiere/u,
  );
  assert.equal(d.files.get(KEY), text);
});

test("a file that is not a bookmark file is not written over", async () => {
  const d = disk();
  d.files.set(KEY, "not json");
  await assert.rejects(
    store(d.window()).remove(FILE, "a"),
    /not a bookmark file/u,
  );
  assert.equal(d.files.get(KEY), "not json");
});

test("a host with nowhere to keep bookmarks has none, and says so when one is added", async () => {
  const bookmarks = store(undefined);
  assert.deepEqual(await bookmarks.read(FILE), []);
  await assert.rejects(
    bookmarks.add(FILE, mark("a", 1)),
    /nowhere to keep bookmarks/u,
  );
  assert.equal(bookmarks.watch(FILE)(), undefined);
});

test("a failed write is reported to the caller and does not stop the next save", async () => {
  const d = disk();
  const files = d.window();
  let fail = true;
  const flaky: PdfBookmarkFiles = {
    ...files,
    write: async (uri, sha, text) => {
      if (fail) {
        throw new Error("disk full");
      }
      await files.write(uri, sha, text);
    },
  };
  const bookmarks = store(flaky);
  await assert.rejects(bookmarks.add(FILE, mark("a", 1)), /disk full/u);
  fail = false;
  await bookmarks.add(FILE, mark("b", 2));
  assert.deepEqual(ids(await bookmarks.read(FILE)), ["b"]);
});

test("a panel's bookmark file is the one for the bytes the viewer has", () => {
  assert.deepEqual(
    bookmarkFileOf({ fileUri: "file:///vault/a.pdf", sha256: SHA }),
    { uri: "file:///vault/a.pdf", sha256: SHA },
  );
  assert.equal(
    bookmarkFileOf({ fileUri: "file:///vault/a.pdf", sha256: undefined }),
    undefined,
  );
  assert.equal(bookmarkFileOf(undefined), undefined);
});
