import assert from "node:assert/strict";
import { test } from "node:test";
// First: the commands import 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { BookmarkStore } from "../../src/host/viewer/bookmark-store";
import type { Bookmark } from "../../src/shared/bookmarks";
import { BOOKMARK_COMMAND_IDS } from "../../src/shared/command-ids";
import type { OutlineItem } from "../../src/shared/messages";
import type * as Commands from "../../src/extension/plugins/pdfBookmarks/bookmark-commands";
import {
  bookmarkDisk,
  fakePanel,
  fakePanels,
  mark,
  sha,
  tick,
  type FakePanelOptions,
} from "./support/bookmarks-fake";

interface InputOptions {
  title?: string;
  prompt?: string;
  value?: string;
  validateInput?: (value: string) => string | undefined;
}
interface Button {
  iconPath: { id: string };
  tooltip: string;
}
interface Item {
  label: string;
  description?: string;
  buttons: Button[];
  bookmark: Bookmark;
}

/** A Quick Pick the test drives: what the reader sees, and what they do. */
function fakeQuickPick() {
  const listeners = {
    accept: new Set<() => void>(),
    hide: new Set<() => void>(),
    button: new Set<(event: { item: Item; button: Button }) => void>(),
  };
  const state = { hidden: false, shown: false };
  const picker = {
    title: "",
    placeholder: "",
    busy: false,
    matchOnDescription: false,
    items: [] as Item[],
    selectedItems: [] as Item[],
    onDidAccept: (listener: () => void) => {
      listeners.accept.add(listener);
      return { dispose: () => listeners.accept.delete(listener) };
    },
    onDidHide: (listener: () => void) => {
      listeners.hide.add(listener);
      return { dispose: () => listeners.hide.delete(listener) };
    },
    onDidTriggerItemButton: (
      listener: (event: { item: Item; button: Button }) => void,
    ) => {
      listeners.button.add(listener);
      return { dispose: () => listeners.button.delete(listener) };
    },
    show: () => {
      state.shown = true;
    },
    hide: () => {
      if (!state.hidden) {
        state.hidden = true;
        for (const listener of [...listeners.hide]) {
          listener();
        }
      }
    },
    dispose: () => undefined,
  };
  return {
    picker,
    state,
    /** Enter on a row. */
    choose: (item: Item) => {
      picker.selectedItems = [item];
      for (const listener of [...listeners.accept]) {
        listener();
      }
    },
    /** A click on one of a row's buttons, by its icon. */
    press: (item: Item, icon: string) => {
      const button = item.buttons.find((each) => each.iconPath.id === icon)!;
      for (const listener of [...listeners.button]) {
        listener({ item, button });
      }
    },
  };
}
type Pick = ReturnType<typeof fakeQuickPick>;

async function open(
  options: {
    panel?: FakePanelOptions;
    bookmarks?: Bookmark[];
    /** What the Input Box answers, given what it was asked. */
    input?: (options: InputOptions) => string | undefined;
  } = {},
) {
  const { registerBookmarkCommands } =
    (await import("../../src/extension/plugins/pdfBookmarks/bookmark-commands")) as typeof Commands;
  const panel = fakePanel({
    position: { page: 4, top: 120, left: 30 },
    ...options.panel,
  });
  const disk = bookmarkDisk();
  if (options.bookmarks) {
    disk.files.set(
      disk.keyOf(panel.sha256!),
      JSON.stringify({ version: 1, bookmarks: options.bookmarks }),
    );
  }
  const store = new BookmarkStore(disk.api, () => undefined);
  const panels = fakePanels(panel);

  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const inputs: InputOptions[] = [];
  const messages: string[] = [];
  const pickers: Pick[] = [];
  const statusBar: string[] = [];
  const originals = {
    registerCommand: fake.commands.registerCommand,
    window: { ...fake.window },
  };
  Object.assign(fake.commands, {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(id, handler);
      return originals.registerCommand(id);
    },
  });
  Object.assign(fake.window, {
    showInputBox: async (asked: InputOptions) => {
      inputs.push(asked);
      return options.input?.(asked);
    },
    showInformationMessage: async (message: string) => {
      messages.push(`info: ${message}`);
    },
    showErrorMessage: async (message: string) => {
      messages.push(`error: ${message}`);
    },
    setStatusBarMessage: (text: string) => {
      statusBar.push(text);
      return { dispose: () => undefined };
    },
    createQuickPick: () => {
      const made = fakeQuickPick();
      pickers.push(made);
      return made.picker;
    },
  });
  const registration = registerBookmarkCommands({
    panels: panels as never,
    store,
  });
  return {
    panel,
    panels,
    store,
    disk,
    inputs,
    messages,
    statusBar,
    pickers,
    saved: () => disk.saved(panel.sha256!),
    registered: () => [...handlers.keys()],
    run: (id: string, ...args: unknown[]) =>
      Promise.resolve(handlers.get(id)!(...args)),
    /** The `index`th Quick Pick, once it has its rows. */
    async pickerAt(index: number): Promise<Pick> {
      for (let attempt = 0; attempt < 20 && !pickers[index]; attempt++) {
        await tick();
      }
      await tick();
      return pickers[index]!;
    },
    close() {
      registration.dispose();
      Object.assign(fake.commands, {
        registerCommand: originals.registerCommand,
      });
      Object.assign(fake.window, originals.window);
    },
  };
}

const ADD = BOOKMARK_COMMAND_IDS.addBookmark;
const GO = BOOKMARK_COMMAND_IDS.goToBookmark;
const RENAME = BOOKMARK_COMMAND_IDS.renameBookmark;
const DELETE = BOOKMARK_COMMAND_IDS.deleteBookmark;

const outline: OutlineItem[] = [
  {
    title: "Part One",
    page: 1,
    top: 0,
    children: [{ title: "Section 1.1", page: 2, top: 0, children: [] }],
  },
];

test("the commands are Add Bookmark, Go to Bookmark, Rename Bookmark and Delete Bookmark", async () => {
  const h = await open();
  assert.deepEqual(
    [ADD, GO, RENAME, DELETE],
    [
      "lumiere.pdf.addBookmark",
      "lumiere.pdf.goToBookmark",
      "lumiere.pdf.renameBookmark",
      "lumiere.pdf.deleteBookmark",
    ],
  );
  assert.deepEqual(h.registered().sort(), [ADD, DELETE, GO, RENAME].sort());
  h.close();
});

test("Add Bookmark offers the section the place is in, and Enter keeps it", async () => {
  const h = await open({
    panel: { outline, position: { page: 4, top: 120, left: 30 } },
    input: (asked) => asked.value,
  });
  await h.run(ADD);
  assert.equal(h.inputs[0]?.title, "Add Bookmark");
  assert.equal(h.inputs[0]?.value, "Section 1.1");
  assert.match(h.inputs[0]?.prompt ?? "", /page 4/u);
  const [saved] = h.saved();
  assert.equal(saved?.title, "Section 1.1");
  assert.equal(saved?.page, 4);
  assert.deepEqual(saved?.position, { top: 120, left: 30 });
  assert.match(saved?.id ?? "", /^[0-9a-f-]{36}$/u);
  assert.ok(Number.isFinite(Date.parse(saved?.created ?? "")));
  assert.deepEqual(h.statusBar, ['$(bookmark) Added bookmark "Section 1.1"']);
  h.close();
});

test("Add Bookmark takes the title typed, trimmed; Escape adds nothing", async () => {
  const typed = await open({ input: () => "  Where I stopped " });
  await typed.run(ADD);
  assert.deepEqual(
    typed.saved().map((bookmark) => bookmark.title),
    ["Where I stopped"],
  );
  typed.close();

  const escaped = await open({ input: () => undefined });
  await escaped.run(ADD);
  assert.deepEqual(escaped.saved(), []);
  assert.deepEqual(escaped.statusBar, []);
  escaped.close();
});

test("with no outline the offered title is Page N, and an empty title is refused", async () => {
  const h = await open({ input: (asked) => asked.value });
  await h.run(ADD);
  assert.equal(h.inputs[0]?.value, "Page 4");
  assert.match(h.inputs[0]?.validateInput?.("  ") ?? "", /Enter a title/u);
  assert.equal(h.inputs[0]?.validateInput?.("Methods"), undefined);
  h.close();
});

test("while the outline is still being read the offered title is Page N", async () => {
  const h = await open({
    panel: { outline: undefined },
    input: (asked) => asked.value,
  });
  await h.run(ADD);
  assert.equal(h.saved()[0]?.title, "Page 4");
  h.close();
});

test("the place is the viewer's last report when it cannot be asked", async () => {
  const h = await open({
    panel: { viewOnly: true, position: { page: 7, top: 5, left: 0 } },
    input: (asked) => asked.value,
  });
  await h.run(ADD);
  assert.deepEqual(
    h.saved().map(({ page, position }) => [page, position]),
    [[7, { top: 5, left: 0 }]],
  );
  h.close();
});

test("a PDF the viewer has not opened yet gets no bookmark, and the reader is told", async () => {
  for (const panel of [
    { position: undefined },
    { sha256: undefined },
  ] satisfies FakePanelOptions[]) {
    const h = await open({ panel, input: () => "never asked" });
    await h.run(ADD);
    assert.deepEqual(h.inputs, []);
    assert.match(h.messages[0] ?? "", /^info: .*still opening/u);
    h.close();
  }
});

test("with no PDF active the commands do nothing", async () => {
  const h = await open({ input: () => "x" });
  h.panels.activate(undefined);
  await h.run(ADD);
  await h.run(GO);
  assert.deepEqual(h.inputs, []);
  assert.deepEqual(h.pickers, []);
  assert.deepEqual(h.messages, []);
  h.close();
});

test("a bookmark that cannot be saved says why", async () => {
  const h = await open({
    bookmarks: [],
    input: () => "Methods",
  });
  h.disk.files.set(h.disk.keyOf(h.panel.sha256!), "not json");
  await h.run(ADD);
  assert.match(
    h.messages[0] ?? "",
    /^error: Could not add the bookmark\. .*not a bookmark file/u,
  );
  assert.deepEqual(h.statusBar, []);
  h.close();
});

const stored = [
  mark("c", 9, 0, "Results"),
  mark("a", 2, 400, "Methods"),
  mark("b", 2, 40, "Intro $(star)"),
];

test("Go to Bookmark lists the PDF's bookmarks in page order, with Rename and Delete on each", async () => {
  const h = await open({ panel: { outline }, bookmarks: stored });
  void h.run(GO);
  const { picker } = await h.pickerAt(0);
  assert.equal(picker.title, "Go to Bookmark");
  assert.equal(picker.placeholder, "Select a bookmark");
  assert.equal(picker.matchOnDescription, true);
  assert.deepEqual(
    picker.items.map((item) => [item.label, item.description]),
    [
      // `$(…)` in a title is text, not an icon.
      ["Intro \\$(star)", "Page 2 · Section 1.1"],
      ["Methods", "Page 2 · Section 1.1"],
      ["Results", "Page 9 · Section 1.1"],
    ],
  );
  assert.deepEqual(
    picker.items[0]?.buttons.map((button) => [
      button.iconPath.id,
      button.tooltip,
    ]),
    [
      ["edit", "Rename Bookmark"],
      ["trash", "Delete Bookmark"],
    ],
  );
  picker.hide();
  h.close();
});

test("a bookmark named for its own section does not say the section twice, and with no outline there is none", async () => {
  const named = await open({
    panel: { outline },
    bookmarks: [mark("a", 2, 10, "Section 1.1")],
  });
  void named.run(GO);
  assert.equal(
    (await named.pickerAt(0)).picker.items[0]?.description,
    "Page 2",
  );
  named.close();

  const bare = await open({ bookmarks: [mark("a", 2, 10, "Methods")] });
  void bare.run(GO);
  assert.equal((await bare.pickerAt(0)).picker.items[0]?.description, "Page 2");
  bare.close();
});

test("choosing a bookmark goes to its page and place, as a deliberate jump", async () => {
  const h = await open({ bookmarks: stored });
  const done = h.run(GO);
  const pick = await h.pickerAt(0);
  pick.choose(pick.picker.items[1]!);
  await done;
  assert.deepEqual(h.panel.jumps, [{ page: 2, top: 400, left: 0 }]);
  assert.equal(pick.state.hidden, true);
  h.close();
});

test("Escape in the Quick Pick goes nowhere", async () => {
  const h = await open({ bookmarks: stored });
  const done = h.run(GO);
  (await h.pickerAt(0)).picker.hide();
  await done;
  assert.deepEqual(h.panel.jumps, []);
  h.close();
});

test("the trash button deletes the bookmark and leaves the Quick Pick open on the rest", async () => {
  const h = await open({ bookmarks: stored });
  void h.run(GO);
  const pick = await h.pickerAt(0);
  pick.press(pick.picker.items[0]!, "trash");
  await tick();
  await tick();
  assert.deepEqual(
    h.saved().map((bookmark) => bookmark.id),
    ["a", "c"],
  );
  assert.deepEqual(
    pick.picker.items.map((item) => item.label),
    ["Methods", "Results"],
  );
  assert.equal(pick.state.hidden, false);
  assert.deepEqual(h.panel.jumps, []);
  pick.picker.hide();
  h.close();
});

test("the edit button asks for a new title, saves it, and brings the Quick Pick back", async () => {
  const h = await open({
    bookmarks: stored,
    input: () => "  Method details ",
  });
  const done = h.run(GO);
  const first = await h.pickerAt(0);
  first.press(first.picker.items[1]!, "edit");
  const second = await h.pickerAt(1);
  assert.equal(h.inputs[0]?.title, "Rename Bookmark");
  assert.equal(h.inputs[0]?.value, "Methods");
  assert.match(h.inputs[0]?.validateInput?.("") ?? "", /Enter a title/u);
  assert.deepEqual(
    second.picker.items.map((item) => item.label),
    ["Intro \\$(star)", "Method details", "Results"],
  );
  second.picker.hide();
  await done;
  assert.equal(
    h.saved().find((bookmark) => bookmark.id === "a")?.title,
    "Method details",
  );
  assert.deepEqual(h.panel.jumps, []);
  h.close();
});

test("Escape in the rename box changes nothing, and the Quick Pick is back", async () => {
  const h = await open({ bookmarks: stored, input: () => undefined });
  const before = h.disk.files.get(h.disk.keyOf(h.panel.sha256!));
  const done = h.run(GO);
  const first = await h.pickerAt(0);
  first.press(first.picker.items[0]!, "edit");
  const second = await h.pickerAt(1);
  assert.equal(second.picker.items.length, 3);
  second.picker.hide();
  await done;
  assert.equal(h.disk.files.get(h.disk.keyOf(h.panel.sha256!)), before);
  h.close();
});

test("with no bookmarks the Quick Pick says so", async () => {
  const h = await open();
  void h.run(GO);
  const { picker } = await h.pickerAt(0);
  assert.deepEqual(picker.items, []);
  assert.equal(picker.placeholder, "No bookmarks in this PDF yet.");
  picker.hide();
  h.close();
});

test("a bookmark saved in another window shows in the open Quick Pick", async () => {
  const h = await open({ bookmarks: [mark("a", 2)] });
  void h.run(GO);
  const pick = await h.pickerAt(0);
  const other = new BookmarkStore(h.disk.api, () => undefined);
  await other.add(
    { uri: h.panel.fileUri, sha256: h.panel.sha256! },
    mark("z", 5, 0, "Added elsewhere"),
  );
  await tick();
  await tick();
  assert.deepEqual(
    pick.picker.items.map((item) => item.label),
    ["Mark a", "Added elsewhere"],
  );
  pick.picker.hide();
  // The file is watched only while the Quick Pick is open.
  assert.equal(h.disk.watchers.size, 0);
  h.close();
});

test("sections appear in an open Quick Pick when the outline arrives", async () => {
  const h = await open({ bookmarks: [mark("a", 2, 10, "Methods")] });
  void h.run(GO);
  const pick = await h.pickerAt(0);
  assert.equal(pick.picker.items[0]?.description, "Page 2");
  h.panel.outline = outline;
  h.panels.changed();
  await tick();
  await tick();
  assert.equal(pick.picker.items[0]?.description, "Page 2 · Section 1.1");
  pick.picker.hide();
  h.close();
});

test("leaving the PDF closes the Quick Pick, and nothing is gone to", async () => {
  const h = await open({ bookmarks: stored });
  const done = h.run(GO);
  const pick = await h.pickerAt(0);
  h.panels.activate(fakePanel({ sha256: sha("other") }));
  await tick();
  assert.equal(pick.state.hidden, true);
  await done;
  assert.deepEqual(h.panel.jumps, []);
  h.close();
});

test("a click on a row goes straight there, with no Quick Pick", async () => {
  const h = await open({ bookmarks: stored });
  await h.run(GO, mark("a", 6, 77, "Anywhere"));
  assert.deepEqual(h.panel.jumps, [{ page: 6, top: 77, left: 0 }]);
  assert.deepEqual(h.pickers, []);
  h.close();
});

test("anything else passed to Go to Bookmark is not a bookmark: the Quick Pick opens", async () => {
  const h = await open({ bookmarks: stored });
  void h.run(GO, { page: "six" });
  const pick = await h.pickerAt(0);
  assert.equal(pick.picker.items.length, 3);
  assert.deepEqual(h.panel.jumps, []);
  pick.picker.hide();
  h.close();
});

test("Rename Bookmark on a row asks for a new title, prefilled, and keeps it", async () => {
  const h = await open({ bookmarks: stored, input: () => "Approach" });
  await h.run(RENAME, mark("a", 2, 400, "Methods"));
  assert.equal(h.inputs[0]?.value, "Methods");
  assert.equal(h.saved().find((each) => each.id === "a")?.title, "Approach");
  h.close();
});

test("renaming to the same title, or Escape, or something that is not a bookmark, writes nothing", async () => {
  const same = await open({ bookmarks: stored, input: () => "Methods" });
  const writes = same.disk.files.get(same.disk.keyOf(same.panel.sha256!));
  await same.run(RENAME, mark("a", 2, 400, "Methods"));
  assert.equal(
    same.disk.files.get(same.disk.keyOf(same.panel.sha256!)),
    writes,
  );
  same.close();

  const none = await open({ bookmarks: stored });
  await none.run(RENAME);
  await none.run(RENAME, "a");
  assert.deepEqual(none.inputs, []);
  none.close();
});

test("Delete Bookmark on a row removes that bookmark", async () => {
  const h = await open({ bookmarks: stored });
  await h.run(DELETE, mark("a", 2, 400, "Methods"));
  assert.deepEqual(
    h.saved().map((bookmark) => bookmark.id),
    ["b", "c"],
  );
  await h.run(DELETE);
  await h.run(DELETE, 42);
  assert.equal(h.saved().length, 2);
  h.close();
});

test("a bookmark that cannot be deleted or renamed says why", async () => {
  const h = await open({ bookmarks: stored, input: () => "New" });
  h.disk.files.set(
    h.disk.keyOf(h.panel.sha256!),
    JSON.stringify({ version: 2, bookmarks: [] }),
  );
  await h.run(DELETE, mark("a", 2));
  await h.run(RENAME, mark("a", 2));
  assert.match(
    h.messages[0] ?? "",
    /^error: Could not delete the bookmark\. .*newer version of Lumiere/u,
  );
  assert.match(
    h.messages[1] ?? "",
    /^error: Could not rename the bookmark\. .*newer version of Lumiere/u,
  );
  h.close();
});
