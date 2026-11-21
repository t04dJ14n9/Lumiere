import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { quickSwitcherHost } from "../../../src/plugins/quickSwitcher/host";
import { provideHostServices } from "../../../src/shared/host";
import { fakeViews, memoryVaults } from "../views/fakes";

/** The labels the switcher offers for `query` when the setting is `value`. */
async function offered(value: boolean | undefined, query: string) {
  const settings =
    value === undefined ? {} : { "vault.showUnsupportedFiles": value };
  const fake = fakeViews(settings);
  const { vaults } = memoryVaults({ "Note.md": "", "data.csv": "" });
  let items: ((query: string) => readonly { label: string }[]) | undefined;
  fake.host.dialogs.pick = async (options) => {
    items = options.items as typeof items;
    return undefined;
  };
  const root = createRoot();
  provideHostServices(root, fake.host);
  root.provide("vaults", vaults);
  root.plugin(quickSwitcherHost);
  await root.settled();
  await fake.commands.get("lumiere.markdown.quickSwitcher")!();
  const labels = items!(query).map((item) => item.label);
  await root.dispose();
  return labels;
}

test("the quick switcher finds unsupported files only when vault.showUnsupportedFiles is on", async () => {
  assert.deepEqual(await offered(undefined, "data"), [
    "$(new-file) Create “data”",
  ]);
  assert.deepEqual(await offered(false, "data"), ["$(new-file) Create “data”"]);
  assert.deepEqual(await offered(true, "data"), [
    "data.csv",
    "$(new-file) Create “data”",
  ]);
});

/**
 * Run the switcher, pressing `key` (one of the modifier keys' commands, or
 * plain Enter) on the row labelled `label` after typing `query`.
 */
async function accept(key: string | undefined, query: string, label?: string) {
  const fake = fakeViews();
  const { vaults } = memoryVaults({ "Note.md": "", "image.png": "" });
  const opened: { uri: string; options: unknown }[] = [];
  vaults.open = async (uri, options) => {
    opened.push({ uri, options });
  };
  const contexts: unknown[][] = [];
  const executed: string[] = [];
  fake.host.hostCommands.execute = async (id, ...args) => {
    executed.push(id);
    if (id === "setContext") {
      contexts.push(args);
    }
    return undefined;
  };
  fake.host.navigation.resolve = async ({ path }) =>
    `memory:///vault/${path}.md`;
  fake.host.dialogs.pick = async (options) => {
    if (key) {
      await fake.commands.get(key)!();
    }
    const item = options
      .items(query)
      .find((candidate) => candidate.label === label);
    return { ...(item && { item }), query };
  };
  const root = createRoot();
  provideHostServices(root, fake.host);
  root.provide("vaults", vaults);
  root.plugin(quickSwitcherHost);
  await root.settled();
  await fake.commands.get("lumiere.markdown.quickSwitcher")!();
  await root.dispose();
  return { opened, contexts, executed };
}

test("Obsidian's modifier keys open the choice in a new tab or to the side, or create the typed name", async () => {
  const note = "memory:///vault/Note.md";
  assert.deepEqual((await accept(undefined, "note", "Note")).opened, [
    { uri: note, options: {} },
  ]);
  const tab = await accept(
    "lumiere.markdown.quickSwitcher.openInNewTab",
    "note",
    "Note",
  );
  assert.deepEqual(tab.opened, [{ uri: note, options: { tab: true } }]);
  // The key accepts the selected row, and only while the switcher is open.
  assert.ok(
    tab.executed.includes("workbench.action.acceptSelectedQuickOpenItem"),
  );
  assert.deepEqual(tab.contexts, [
    ["lumiere.markdown.quickSwitcherOpen", true],
    ["lumiere.markdown.quickSwitcherOpen", false],
  ]);
  assert.deepEqual(
    (await accept("lumiere.markdown.quickSwitcher.openToSide", "note", "Note"))
      .opened,
    [{ uri: note, options: { side: true } }],
  );
  // Shift+Enter creates the typed name even though "Note" is selected.
  assert.deepEqual(
    (await accept("lumiere.markdown.quickSwitcher.create", "No", "Note"))
      .opened,
    [{ uri: "memory:///vault/No.md", options: {} }],
  );
  assert.deepEqual(
    (
      await accept(
        "lumiere.markdown.quickSwitcher.createInNewTab",
        "No",
        "Note",
      )
    ).opened,
    [{ uri: "memory:///vault/No.md", options: { tab: true } }],
  );
});
