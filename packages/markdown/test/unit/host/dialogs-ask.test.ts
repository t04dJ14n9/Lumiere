import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { Dialogs } from "../../../src/shared/host";

type MessageItem = { title: string; isCloseAffordance?: boolean };

function loadDialogs(reply: string | MessageItem | undefined) {
  const calls: unknown[][] = [];
  const vscode = {
    window: {
      showInformationMessage: async (...args: unknown[]) => {
        calls.push(args);
        return reply;
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
  for (const id of Object.keys(require.cache)) {
    if (id.includes("/src/host/")) {
      delete require.cache[id];
    }
  }
  let dialogs: Dialogs;
  try {
    const workbench = require("../../../src/host/services/workbench.ts") as {
      createDialogs(): Dialogs;
    };
    dialogs = workbench.createDialogs();
  } finally {
    loader._load = originalLoad;
  }
  return { dialogs, calls };
}

function titles(items: unknown[]): string[] {
  return items.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    assert.ok(item && typeof item === "object" && "title" in item);
    return String((item as MessageItem).title);
  });
}

test("a modal ask marks Cancel as the close affordance so VS Code does not add a second Cancel", async () => {
  const actions = ["Save and Copy", "Copy Text Only", "Cancel"];
  const { dialogs, calls } = loadDialogs({
    title: "Cancel",
    isCloseAffordance: true,
  });
  const choice = await dialogs.ask(
    "This note has unsaved changes. Save it so the reference matches the file?",
    actions,
  );
  assert.equal(calls.length, 1);
  const [message, options, ...items] = calls[0]!;
  assert.equal(
    message,
    "This note has unsaved changes. Save it so the reference matches the file?",
  );
  assert.deepEqual(options, { modal: true });
  assert.deepEqual(titles(items), actions);
  const close = items.filter(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as MessageItem).isCloseAffordance === true,
  );
  assert.equal(close.length, 1);
  assert.deepEqual(close[0], { title: "Cancel", isCloseAffordance: true });
  assert.equal(choice, "Cancel");
});

test("a modal ask returns the chosen action title and leaves dismiss as undefined", async () => {
  const actions = ["Save and Copy", "Copy Text Only", "Cancel"];
  const saved = loadDialogs({ title: "Save and Copy" });
  assert.equal(
    await saved.dialogs.ask(
      "Save it so the reference matches the file?",
      actions,
    ),
    "Save and Copy",
  );
  const textOnly = loadDialogs({ title: "Copy Text Only" });
  assert.equal(
    await textOnly.dialogs.ask(
      "Save it so the reference matches the file?",
      actions,
    ),
    "Copy Text Only",
  );
  const dismissed = loadDialogs(undefined);
  assert.equal(
    await dismissed.dialogs.ask(
      "Save it so the reference matches the file?",
      actions,
    ),
    undefined,
  );
});

test("a modal ask does not mark a close affordance when a real caller passes no Cancel", async () => {
  // packages/markdown/src/plugins/attachments/download-command.ts
  const downloadActions = ["Download"];
  const download = loadDialogs({ title: "Download" });
  assert.equal(
    await download.dialogs.ask(
      "Download the 1 image this note shows from the web into the vault?",
      downloadActions,
    ),
    "Download",
  );
  const downloadItems = download.calls[0]!.slice(2);
  assert.deepEqual(titles(downloadItems), downloadActions);
  assert.equal(
    downloadItems.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as MessageItem).isCloseAffordance === true,
    ).length,
    0,
  );

  // packages/markdown/src/plugins/linkUpdates/host.ts
  const updateActions = ["Update Links", "Always Update", "Don't Update"];
  const updates = loadDialogs({ title: "Don't Update" });
  assert.equal(
    await updates.dialogs.ask("Update links in 1 file?", updateActions),
    "Don't Update",
  );
  const updateItems = updates.calls[0]!.slice(2);
  assert.deepEqual(titles(updateItems), updateActions);
  assert.equal(
    updateItems.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as MessageItem).isCloseAffordance === true,
    ).length,
    0,
  );
});
