import { provideHostServices } from "../../../src/shared/host";
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { linkUpdatesHost } from "../../../src/plugins/linkUpdates/host";
import { config as linkUpdatesConfig } from "../../../src/plugins/linkUpdates/manifest";
import { fakeViews, memoryVaults, uriOf, hostWith } from "../views/fakes";

const notes = {
  "Topic/Old.md": "",
  "A.md": "See [[Old|the old note]] and [[Old#Part]].",
  "B.md": "Embed ![[Old]]",
};

const rename = [
  { oldUri: uriOf("Topic/Old.md"), newUri: uriOf("Topic/New.md") },
];

/** Starts the rename host over an in-memory vault, as the other host tests do. */
async function startHost(settings: Record<string, unknown> = {}) {
  const { vaults } = memoryVaults(notes);
  const fake = fakeViews(settings);
  const root = createRoot();
  root.provide("vaults", vaults);
  const host = hostWith(fake);
  provideHostServices(root, host);
  root.plugin(linkUpdatesHost);
  await root.settled();
  return { root, fake, host };
}

test("linkUpdates.mode defaults to prompt, as Obsidian's alwaysUpdateLinks: false", () => {
  assert.equal(linkUpdatesConfig.parse({}).mode, "prompt");
  const properties = linkUpdatesConfig.toJSONSchema().properties as {
    mode: { default?: unknown };
  };
  assert.equal(properties.mode.default, "prompt");
});

test("explicit linkUpdates modes survive a default change", () => {
  for (const mode of ["prompt", "always", "never"] as const) {
    assert.equal(linkUpdatesConfig.parse({ mode }).mode, mode);
  }
});

test("Always Update persists always and skips future dialogs", async () => {
  const { root, fake, host } = await startHost({
    "linkUpdates.mode": "prompt",
  });
  const writes: unknown[][] = [];
  host.settings.access.update = async (key, value, resource, scope) => {
    writes.push([key, value, resource, scope]);
    // Mirror the real host: the settings write is read back by the next rename.
    fake.settings[key] = value;
    return "user";
  };
  fake.answerWith("Always Update");
  assert.equal((await fake.rename(rename)).length, 2);
  assert.deepEqual(writes, [
    ["linkUpdates.mode", "always", uriOf("Topic/Old.md"), "workspaceFolder"],
  ]);
  // The persisted choice makes the next rename of this note skip the dialog.
  assert.equal((await fake.rename(rename)).length, 2);
  assert.deepEqual(fake.prompts, ["Update links in 2 files?"]);
  await root.dispose();
});

test("a mode that cannot be saved does not cost the user the update they asked for", async () => {
  const { root, fake, host } = await startHost({
    "linkUpdates.mode": "prompt",
  });
  host.settings.access.update = async () => {
    throw new Error("Unable to write to Folder Settings: the file has errors");
  };
  const errors: string[] = [];
  host.dialogs.error = (message) => {
    errors.push(message);
  };
  fake.answerWith("Always Update");
  assert.equal((await fake.rename(rename)).length, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /could not save/i);
  assert.match(errors[0] ?? "", /the file has errors/);
  await root.dispose();
});

test("declining or cancelling the dialog does not persist never", async () => {
  const { root, fake, host } = await startHost({
    "linkUpdates.mode": "prompt",
  });
  const writes: unknown[][] = [];
  host.settings.access.update = async (key, value, resource, scope) => {
    writes.push([key, value, resource, scope]);
    return "user";
  };
  fake.answerWith(undefined);
  assert.deepEqual(await fake.rename(rename), []);
  fake.answerWith("Don't Update");
  assert.deepEqual(await fake.rename(rename), []);
  assert.deepEqual(writes, []);
  assert.deepEqual(fake.prompts, [
    "Update links in 2 files?",
    "Update links in 2 files?",
  ]);
  assert.equal(fake.settings["linkUpdates.mode"], "prompt");
  await root.dispose();
});
