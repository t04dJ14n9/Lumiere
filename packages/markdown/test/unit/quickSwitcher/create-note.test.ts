import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRoot } from "@workshop/core";
import { quickSwitcherHost } from "../../../src/plugins/quickSwitcher/host";
import { provideHostServices } from "../../../src/shared/host";
import { diskNavigation } from "../../support/disk-navigation";
import { fakeViews, memoryVaults } from "../views/fakes";

/**
 * Type `query` into the switcher with no note open, over the real
 * navigation (the host's resolve and create, on the real disk), and say
 * which note it opened.
 */
async function createFromSwitcher(directory: string, query: string) {
  const root = pathToFileURL(directory).href;
  const fake = fakeViews();
  const { vaults } = memoryVaults({ "Existing.md": "" }, root);
  const opened: string[] = [];
  vaults.open = async (uri) => {
    opened.push(uri);
  };
  // No active note: the switcher names the vault root as the source.
  assert.equal(fake.host.activeEditor.note(), undefined);
  fake.host.navigation.resolve = diskNavigation().resolve;
  fake.host.dialogs.pick = async () => ({ query });
  const tree = createRoot();
  provideHostServices(tree, fake.host);
  tree.provide("vaults", vaults);
  tree.plugin(quickSwitcherHost);
  await tree.settled();
  await fake.commands.get("lumiere.markdown.quickSwitcher")!();
  await tree.dispose();
  return opened;
}

test("a note typed into the switcher is made in the vault when no note is open", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-switcher-create-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "Existing.md"), "kept");
  const href = (path: string) => pathToFileURL(join(directory, path)).href;

  assert.deepEqual(await createFromSwitcher(directory, "NewNote"), [
    href("NewNote.md"),
  ]);
  assert.equal(await readFile(join(directory, "NewNote.md"), "utf8"), "");
  assert.deepEqual(await createFromSwitcher(directory, "area/NewNote"), [
    href("area/NewNote.md"),
  ]);
  assert.equal(await readFile(join(directory, "area/NewNote.md"), "utf8"), "");
  // A name that exists opens that note and leaves it as it was.
  assert.deepEqual(await createFromSwitcher(directory, "Existing.md"), [
    href("Existing.md"),
  ]);
  assert.equal(await readFile(join(directory, "Existing.md"), "utf8"), "kept");
});
