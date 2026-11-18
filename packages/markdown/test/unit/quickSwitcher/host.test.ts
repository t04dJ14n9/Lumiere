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
