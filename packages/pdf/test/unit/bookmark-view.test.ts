import assert from "node:assert/strict";
import { test } from "node:test";
// First: the view imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { BookmarkStore } from "../../src/host/viewer/bookmark-store";
import type { Bookmark } from "../../src/shared/bookmarks";
import type * as View from "../../src/extension/plugins/pdfBookmarks/bookmark-view";
import { BOOKMARK_COMMAND_IDS } from "../../src/shared/command-ids";
import {
  bookmarkDisk,
  fakePanel,
  fakePanels,
  mark,
  sha,
  tick,
} from "./support/bookmarks-fake";

interface Provider {
  getChildren(): Bookmark[];
  getTreeItem(bookmark: Bookmark): Record<string, unknown>;
  onDidChangeTreeData(listener: () => void): unknown;
}

/** The view registered over fake panels and one disk; `provider` is what VS Code would ask. */
async function open(
  setup: (disk: ReturnType<typeof bookmarkDisk>) => void = () => undefined,
) {
  const { registerBookmarksView } =
    (await import("../../src/extension/plugins/pdfBookmarks/bookmark-view")) as typeof View;
  const disk = bookmarkDisk();
  setup(disk);
  const store = new BookmarkStore(disk.api, () => undefined);
  const first = fakePanel({ sha256: sha("one") });
  const panels = fakePanels(first);
  let provider!: Provider;
  const view = { message: undefined as string | undefined, dispose() {} };
  let viewId = "";
  const original = fake.window.createTreeView;
  Object.assign(fake.window, {
    createTreeView: (id: string, options: { treeDataProvider: Provider }) => {
      viewId = id;
      provider = options.treeDataProvider;
      return view;
    },
  });
  let changes = 0;
  const errors: string[] = [];
  const registration = registerBookmarksView(panels as never, store, {
    warn: (message: string) => errors.push(message),
  } as never);
  Object.assign(fake.window, { createTreeView: original });
  provider.onDidChangeTreeData(() => {
    changes++;
  });
  await tick();
  return {
    disk,
    store,
    panels,
    first,
    provider,
    view,
    viewId: () => viewId,
    changes: () => changes,
    errors,
    registration,
  };
}

const titles = (provider: Provider) =>
  provider.getChildren().map((bookmark) => bookmark.title);

test("the view is PDF Bookmarks in the Explorer, with a row per bookmark of the active PDF", async () => {
  const h = await open((disk) =>
    disk.files.set(
      disk.keyOf(sha("one")),
      JSON.stringify({
        version: 1,
        bookmarks: [mark("b", 9, 0, "Results"), mark("a", 2, 0, "Methods")],
      }),
    ),
  );
  assert.equal(h.viewId(), "lumiere.pdf.bookmarks");
  assert.deepEqual(titles(h.provider), ["Methods", "Results"]);
  h.registration.dispose();
});

test("a row shows the title and the page, jumps on a click, and takes Rename and Delete", async () => {
  const h = await open((disk) =>
    disk.files.set(
      disk.keyOf(sha("one")),
      JSON.stringify({
        version: 1,
        bookmarks: [mark("a", 12, 340, "Methods")],
      }),
    ),
  );
  const bookmark = h.provider.getChildren()[0]!;
  const row = h.provider.getTreeItem(bookmark) as {
    label: string;
    description: string;
    tooltip: string;
    contextValue: string;
    id: string;
    collapsibleState: number;
    iconPath: { id: string };
    command: { command: string; arguments: unknown[] };
  };
  assert.equal(row.label, "Methods");
  assert.equal(row.description, "Page 12");
  assert.equal(row.tooltip, "Methods — page 12");
  assert.equal(row.contextValue, "lumiere.pdf.bookmark");
  assert.equal(row.id, "a");
  assert.equal(row.collapsibleState, fake.TreeItemCollapsibleState.None);
  assert.equal(row.iconPath.id, "bookmark");
  assert.equal(row.command.command, BOOKMARK_COMMAND_IDS.goToBookmark);
  assert.deepEqual(row.command.arguments, [bookmark]);
  h.registration.dispose();
});

test("with no PDF active, or before the viewer has its bytes, there are no rows", async () => {
  const h = await open();
  h.panels.activate(undefined);
  await tick();
  assert.deepEqual(titles(h.provider), []);
  h.panels.activate(fakePanel({ sha256: undefined }));
  await tick();
  assert.deepEqual(titles(h.provider), []);
  h.registration.dispose();
});

test("adding, renaming and deleting a bookmark change the rows at once", async () => {
  const h = await open();
  const file = { uri: h.first.fileUri, sha256: sha("one") };
  assert.deepEqual(titles(h.provider), []);
  const before = h.changes();
  await h.store.add(file, mark("b", 5, 0, "Later"));
  await h.store.add(file, mark("a", 1, 0, "Earlier"));
  await tick();
  assert.deepEqual(titles(h.provider), ["Earlier", "Later"]);
  assert.ok(h.changes() > before);
  await h.store.rename(file, "a", "First");
  await tick();
  assert.deepEqual(titles(h.provider), ["First", "Later"]);
  await h.store.remove(file, "b");
  await tick();
  assert.deepEqual(titles(h.provider), ["First"]);
  h.registration.dispose();
});

test("another window's save shows through the file watcher", async () => {
  const h = await open();
  const other = new BookmarkStore(h.disk.api, () => undefined);
  await other.add({ uri: h.first.fileUri, sha256: sha("one") }, mark("a", 4));
  await tick();
  assert.deepEqual(titles(h.provider), ["Mark a"]);
  h.registration.dispose();
});

test("the rows follow the active PDF, and another PDF's bookmarks never show on this one", async () => {
  const h = await open();
  const second = fakePanel({ sha256: sha("two"), uri: "file:///vault/b.pdf" });
  await h.store.add({ uri: h.first.fileUri, sha256: sha("one") }, mark("a", 1));
  await h.store.add({ uri: second.fileUri, sha256: sha("two") }, mark("b", 2));
  await tick();
  assert.deepEqual(titles(h.provider), ["Mark a"]);
  h.panels.activate(second);
  await tick();
  assert.deepEqual(titles(h.provider), ["Mark b"]);
  // A save to the file of the PDF that is not shown leaves the rows alone.
  await h.store.add({ uri: h.first.fileUri, sha256: sha("one") }, mark("c", 3));
  await tick();
  assert.deepEqual(titles(h.provider), ["Mark b"]);
  h.registration.dispose();
});

test("the page reports of the active PDF do not read the file again", async () => {
  const h = await open();
  const reads = { count: 0 };
  const read = h.disk.api.read;
  h.disk.api.read = async (uri, hash) => {
    reads.count++;
    return read(uri, hash);
  };
  for (let report = 0; report < 20; report++) {
    h.panels.changed();
  }
  await tick();
  assert.equal(reads.count, 0);
  h.registration.dispose();
});

test("the PDF's file is watched while it is shown, and not after the view goes", async () => {
  const h = await open();
  assert.equal(h.disk.watchers.size, 1);
  h.panels.activate(fakePanel({ sha256: sha("two") }));
  await tick();
  assert.equal(h.disk.watchers.size, 1, "the old file's watcher is replaced");
  h.registration.dispose();
  assert.equal(h.disk.watchers.size, 0);
  assert.equal(h.panels.listeners.size, 0);
});

test("a file that cannot be read shows no rows, and the view says why", async () => {
  const h = await open((disk) =>
    disk.files.set(
      disk.keyOf(sha("one")),
      JSON.stringify({ version: 2, bookmarks: [] }),
    ),
  );
  assert.deepEqual(titles(h.provider), []);
  assert.match(h.view.message ?? "", /newer version of Lumiere/u);
  assert.equal(h.errors.length, 1);
  // Another PDF's file reads fine: the message goes.
  h.panels.activate(fakePanel({ sha256: sha("two") }));
  await tick();
  assert.ok(!h.view.message);
  h.registration.dispose();
});
