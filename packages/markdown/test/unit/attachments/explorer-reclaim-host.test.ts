import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as Reclaim from "../../../src/host/attachments-explorer-reclaim";
import { MARKDOWN_EDITOR } from "../../../src/shared/editor-provider";
import { forgetModules } from "../../support/module-cache";

class TabInputCustom {
  constructor(
    readonly uri: FakeUri,
    readonly viewType: string,
  ) {}
}
class FakeUri {
  constructor(readonly path: string) {}
  get fsPath() {
    return this.path;
  }
  toString() {
    return `file://${this.path}`;
  }
  static parse(value: string) {
    return new FakeUri(value.replace(/^file:\/\//, ""));
  }
}

function harness(answer: string | undefined) {
  const note = new TabInputCustom(
    new FakeUri("/v/note.md"),
    MARKDOWN_EDITOR.viewType,
  );
  const group = {
    viewColumn: 1,
    activeTab: undefined as unknown,
    tabs: [] as unknown[],
  };
  const noteTab = { input: note, isPreview: false, group };
  group.tabs.push(noteTab);
  group.activeTab = noteTab;
  let listener: ((event: { opened: unknown[] }) => void) | undefined;
  const closed: unknown[] = [];
  const asked: string[] = [];
  const vscode = {
    TabInputCustom,
    Uri: FakeUri,
    window: {
      tabGroups: {
        all: [group],
        onDidChangeTabs: (callback: typeof listener) => {
          listener = callback;
          return { dispose() {} };
        },
        close: async (tab: unknown) => {
          closed.push(tab);
        },
      },
      showInformationMessage: async (message: string) => {
        asked.push(message);
        return answer;
      },
    },
  };
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  forgetModules(require, "/src/host/");
  let reclaim: typeof Reclaim;
  try {
    reclaim =
      require("../../../src/host/attachments-explorer-reclaim.ts") as typeof Reclaim;
  } finally {
    loader._load = originalLoad;
  }
  const reclaimed: unknown[] = [];
  reclaim.registerAttachmentsExplorerReclaim({
    reclaim: async (args) => {
      reclaimed.push(args);
    },
  });
  const open = async (path: string, isPreview = false) => {
    const tab = { input: { uri: new FakeUri(path) }, isPreview, group };
    group.tabs.push(tab);
    group.activeTab = tab;
    listener!({ opened: [tab] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return tab;
  };
  return { open, closed, asked, reclaimed, ADD: reclaim.ADD_TO_NOTE };
}

test("an image opened over a note (`code image.png`) stays open unless the reader adds it", async () => {
  const h = harness(undefined);
  await h.open("/v/links-mr.png");
  assert.deepEqual(h.asked, ["Add links-mr.png to note.md as an attachment?"]);
  assert.deepEqual(h.closed, [], "the image tab stays open");
  assert.deepEqual(h.reclaimed, [], "nothing is inserted into the note");
});

test("Add to Note closes the image tab and inserts it, as an Explorer drop did", async () => {
  const h = harness("Add to Note");
  const tab = await h.open("/v/shot.png");
  assert.equal(h.ADD, "Add to Note");
  assert.deepEqual(h.closed, [tab]);
  assert.deepEqual(h.reclaimed, [
    {
      resourceUri: "file:///v/shot.png",
      column: 1,
      lumiereUri: "file:///v/note.md",
    },
  ]);
});

test("a preview open or a note is not offered", async () => {
  const h = harness("Add to Note");
  await h.open("/v/preview.png", true);
  await h.open("/v/other.md");
  assert.deepEqual(h.asked, []);
  assert.deepEqual(h.reclaimed, []);
});
