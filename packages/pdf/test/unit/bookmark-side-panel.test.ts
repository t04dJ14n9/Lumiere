import assert from "node:assert/strict";
import { test } from "node:test";
// First: the commands import 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { BookmarkStore } from "../../src/host/viewer/bookmark-store";
import type { Bookmark } from "../../src/shared/bookmarks";
import type * as Commands from "../../src/extension/plugins/pdfBookmarks/bookmark-commands";
import type * as Feed from "../../src/extension/plugins/pdfBookmarks/panel-feed";
import {
  bookmarkDisk,
  fakePanel,
  mark,
  sha,
  tick,
} from "./support/bookmarks-fake";

interface InputOptions {
  title?: string;
  value?: string;
}

/** The commands' module, with the Input Box and messages the test answers. */
async function commands(input: (asked: InputOptions) => string | undefined) {
  const module =
    (await import("../../src/extension/plugins/pdfBookmarks/bookmark-commands")) as typeof Commands;
  const original = { ...fake.window };
  const inputs: InputOptions[] = [];
  const messages: string[] = [];
  Object.assign(fake.window, {
    showInputBox: async (asked: InputOptions) => {
      inputs.push(asked);
      return input(asked);
    },
    showErrorMessage: async (message: string) => {
      messages.push(message);
    },
    showInformationMessage: async (message: string) => {
      messages.push(message);
    },
    setStatusBarMessage: () => ({ dispose: () => undefined }),
  });
  return {
    ...module,
    inputs,
    messages,
    restore: () => Object.assign(fake.window, original),
  };
}

function disk(bookmarks: Bookmark[] = []) {
  const files = bookmarkDisk();
  const panel = fakePanel({ position: { page: 4, top: 120, left: 30 } });
  files.files.set(
    files.keyOf(panel.sha256!),
    JSON.stringify({ version: 1, bookmarks }),
  );
  const store = new BookmarkStore(files.api, () => undefined);
  return { files, panel, store, saved: () => files.saved(panel.sha256!) };
}

test("the side panel's Add asks for a title in its own editor and saves the place that editor is at", async () => {
  const h = disk();
  const c = await commands((asked) => asked.value);
  await c.addBookmarkTo(h.store, h.panel as never);
  assert.equal(c.inputs[0]?.title, "Add Bookmark");
  const [saved] = h.saved();
  assert.equal(saved?.page, 4);
  assert.deepEqual(saved?.position, { top: 120, left: 30 });
  c.restore();
});

test("Add from the panel adds nothing when the title is cancelled", async () => {
  const h = disk();
  const c = await commands(() => undefined);
  await c.addBookmarkTo(h.store, h.panel as never);
  assert.deepEqual(h.saved(), []);
  c.restore();
});

test("Rename from the panel asks with the bookmark's title and keeps what is typed", async () => {
  const h = disk([mark("a", 2, 0, "Old"), mark("b", 5, 0, "Other")]);
  const c = await commands(() => "New title");
  await c.renameBookmarkIn(h.store, h.panel as never, "a");
  assert.equal(c.inputs[0]?.title, "Rename Bookmark");
  assert.equal(c.inputs[0]?.value, "Old");
  assert.deepEqual(
    h.saved().map((bookmark) => bookmark.title),
    ["New title", "Other"],
  );
  c.restore();
});

test("Rename of a bookmark that is gone asks nothing, and nothing is written", async () => {
  const h = disk([mark("b", 5, 0, "Other")]);
  const c = await commands(() => "New title");
  await c.renameBookmarkIn(h.store, h.panel as never, "gone");
  assert.deepEqual(c.inputs, []);
  assert.deepEqual(
    h.saved().map((bookmark) => bookmark.title),
    ["Other"],
  );
  c.restore();
});

test("Delete from the panel removes the bookmark at once", async () => {
  const h = disk([mark("a", 2), mark("b", 5)]);
  const c = await commands(() => undefined);
  await c.deleteBookmarkIn(h.store, h.panel as never, "a");
  assert.deepEqual(
    h.saved().map((bookmark) => bookmark.id),
    ["b"],
  );
  assert.deepEqual(c.inputs, []);
  c.restore();
});

test("a file that cannot be used is said to the reader, not thrown", async () => {
  const h = disk();
  h.files.files.set(h.files.keyOf(h.panel.sha256!), "not a bookmark file");
  const c = await commands(() => "x");
  await c.renameBookmarkIn(h.store, h.panel as never, "a");
  await c.deleteBookmarkIn(h.store, h.panel as never, "a");
  assert.equal(c.messages.length, 2);
  assert.match(c.messages[0]!, /Could not read the bookmarks/u);
  assert.match(c.messages[1]!, /Could not delete the bookmark/u);
  c.restore();
});

/** An editor as the feed uses it: it reports changes, takes bookmarks, and can be closed. */
function feedPanel(options: Parameters<typeof fakePanel>[0] = {}) {
  const base = fakePanel(options);
  const listeners = new Set<() => void>();
  const closers = new Set<() => void>();
  const staleListeners = new Set<() => void>();
  const sent: {
    items: readonly Bookmark[];
    sha256: string;
    problem: string | undefined;
  }[] = [];
  const panel = {
    ...base,
    onDidChange: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    bookmarks: {
      set: (items: readonly Bookmark[], sha256: string, problem?: string) =>
        sent.push({ items, sha256, problem }),
      onStale: (listener: () => void) => {
        staleListeners.add(listener);
        return { dispose: () => staleListeners.delete(listener) };
      },
    },
    webviewPanel: {
      onDidDispose: (listener: () => void) => {
        closers.add(listener);
        return { dispose: () => closers.delete(listener) };
      },
    },
  };
  return {
    panel,
    sent,
    report: () => listeners.forEach((listener) => listener()),
    close: () => closers.forEach((listener) => listener()),
    /** The editor's viewer was given other bytes than the list was read for. */
    stale: () => staleListeners.forEach((listener) => listener()),
    listeners,
    closers,
    staleListeners,
  };
}

async function feeding(
  setup: (files: ReturnType<typeof bookmarkDisk>) => void = () => undefined,
) {
  const { feedPanelBookmarks } =
    (await import("../../src/extension/plugins/pdfBookmarks/panel-feed")) as typeof Feed;
  const files = bookmarkDisk();
  setup(files);
  const store = new BookmarkStore(files.api, () => undefined);
  const opened = new Set<(panel: never) => void>();
  const open: ReturnType<typeof feedPanel>[] = [];
  const warnings: string[] = [];
  const registration = feedPanelBookmarks(
    {
      all: open.map((entry) => entry.panel),
      onDidOpen: (listener: (panel: never) => void) => {
        opened.add(listener);
        return { dispose: () => opened.delete(listener) };
      },
    } as never,
    store,
    { warn: (message: string) => warnings.push(message) } as never,
  );
  return {
    files,
    store,
    registration,
    warnings,
    /** An editor opens. */
    async show(options: Parameters<typeof fakePanel>[0] = {}) {
      const shown = feedPanel(options);
      open.push(shown);
      for (const listener of opened) {
        listener(shown.panel as never);
      }
      await tick();
      return shown;
    },
    listenerCount: () => opened.size,
  };
}

test("an editor's bookmarks are sent to it when it opens", async () => {
  const h = await feeding((files) =>
    files.files.set(
      files.keyOf(sha("a")),
      JSON.stringify({ version: 1, bookmarks: [mark("a", 2, 0, "Methods")] }),
    ),
  );
  const shown = await h.show();
  assert.deepEqual(shown.sent.at(-1), {
    items: [mark("a", 2, 0, "Methods")],
    sha256: sha("a"),
    problem: undefined,
  });
  h.registration.dispose();
});

test("an editor whose bytes are not known yet gets its bookmarks once they are", async () => {
  const h = await feeding((files) =>
    files.files.set(
      files.keyOf(sha("a")),
      JSON.stringify({ version: 1, bookmarks: [mark("a", 2)] }),
    ),
  );
  const shown = await h.show({ sha256: undefined });
  const lastSent = () => shown.sent.at(-1);
  assert.equal(lastSent(), undefined);
  (shown.panel as { sha256: string | undefined }).sha256 = sha("a");
  shown.report();
  await tick();
  assert.equal(lastSent()?.items.length, 1);
  h.registration.dispose();
});

test("page reports read nothing again; a save here, or another window's, sends the new list", async () => {
  const h = await feeding();
  const shown = await h.show();
  const before = shown.sent.length;
  shown.report();
  shown.report();
  await tick();
  assert.equal(shown.sent.length, before);
  await h.store.add(
    { uri: shown.panel.fileUri, sha256: sha("a") },
    mark("x", 3, 0, "Added"),
  );
  await tick();
  assert.deepEqual(
    shown.sent.at(-1)?.items.map((bookmark) => bookmark.title),
    ["Added"],
  );
  h.registration.dispose();
});

test("each editor is sent the bookmarks of its own PDF, not the active one's", async () => {
  const h = await feeding((files) => {
    files.files.set(
      files.keyOf(sha("one")),
      JSON.stringify({ version: 1, bookmarks: [mark("1", 1, 0, "In one")] }),
    );
    files.files.set(
      files.keyOf(sha("two")),
      JSON.stringify({ version: 1, bookmarks: [mark("2", 2, 0, "In two")] }),
    );
  });
  const one = await h.show({ sha256: sha("one") });
  const two = await h.show({ sha256: sha("two") });
  assert.deepEqual(
    one.sent.at(-1)?.items.map((bookmark) => bookmark.title),
    ["In one"],
  );
  assert.deepEqual(
    two.sent.at(-1)?.items.map((bookmark) => bookmark.title),
    ["In two"],
  );
  h.registration.dispose();
});

test("a file that cannot be read is said in the tab and in the log", async () => {
  const h = await feeding((files) =>
    files.files.set(files.keyOf(sha("a")), "not a bookmark file"),
  );
  const shown = await h.show();
  assert.deepEqual(shown.sent.at(-1)?.items, []);
  assert.match(shown.sent.at(-1)?.problem ?? "", /not a bookmark file/u);
  assert.equal(h.warnings.length, 1);
  h.registration.dispose();
});

test("a closed editor, and a stopped plugin, are left alone", async () => {
  const h = await feeding();
  const shown = await h.show();
  shown.close();
  assert.equal(shown.listeners.size, 0);
  const next = await h.show();
  h.registration.dispose();
  assert.equal(next.listeners.size, 0);
  assert.equal(h.listenerCount(), 0);
  assert.equal(h.files.watchers.size, 0);
});

test("a PDF replaced by another is read again when its list is said to be stale, with no report to wait for", async () => {
  const h = await feeding((files) => {
    files.files.set(
      files.keyOf(sha("a")),
      JSON.stringify({ version: 1, bookmarks: [mark("a", 2, 0, "Old PDF")] }),
    );
    files.files.set(
      files.keyOf(sha("b")),
      JSON.stringify({ version: 1, bookmarks: [mark("b", 3, 0, "New PDF")] }),
    );
  });
  const shown = await h.show({ sha256: sha("a") });
  assert.deepEqual(
    shown.sent.at(-1)?.items.map((bookmark) => bookmark.title),
    ["Old PDF"],
  );
  // The new file fails to open, so its viewer never reports: only the outlet knows.
  (shown.panel as { sha256: string | undefined }).sha256 = sha("b");
  shown.stale();
  await tick();
  const last = shown.sent.at(-1);
  assert.deepEqual(
    last?.items.map((bookmark) => bookmark.title),
    ["New PDF"],
  );
  assert.equal(last?.sha256, sha("b"));
  h.registration.dispose();
});

test("stopping the plugin lets go of every editor's subscriptions, though the editors stay open", async () => {
  const h = await feeding();
  const one = await h.show({ sha256: sha("one") });
  const two = await h.show({ sha256: sha("two") });
  assert.equal(one.closers.size, 1);
  assert.equal(one.staleListeners.size, 1);
  h.registration.dispose();
  for (const shown of [one, two]) {
    assert.equal(shown.closers.size, 0, "the editor's dispose listener");
    assert.equal(shown.staleListeners.size, 0, "the stale listener");
    assert.equal(shown.listeners.size, 0, "the change listener");
  }
  assert.equal(h.files.watchers.size, 0);
});

test("an editor that closes lets go of its own subscriptions", async () => {
  const h = await feeding();
  const shown = await h.show();
  shown.close();
  assert.equal(shown.closers.size, 0);
  assert.equal(shown.staleListeners.size, 0);
  h.registration.dispose();
});
