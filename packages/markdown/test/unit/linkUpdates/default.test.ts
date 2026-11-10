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

test("linkUpdates.mode defaults to never, as Obsidian's alwaysUpdateLinks: false", () => {
  assert.equal(linkUpdatesConfig.parse({}).mode, "never");
  const properties = linkUpdatesConfig.toJSONSchema().properties as {
    mode: { default?: unknown };
  };
  assert.equal(properties.mode.default, "never");
});

test("Always Update persists always and skips future dialogs", async () => {
  const { root, fake, host } = await startHost({
    "linkUpdates.mode": "prompt",
  });
  const writes: unknown[][] = [];
  host.settings.access.update = async (key, value, resource) => {
    writes.push([key, value, resource]);
    // Mirror the real host: the settings write is read back by the next rename.
    fake.settings[key] = value;
    return "user";
  };
  fake.answerWith("Always Update");
  assert.equal((await fake.rename(rename)).length, 2);
  assert.deepEqual(writes, [
    ["linkUpdates.mode", "always", uriOf("Topic/Old.md")],
  ]);
  // The persisted choice makes the next rename of this note skip the dialog.
  assert.equal((await fake.rename(rename)).length, 2);
  assert.deepEqual(fake.prompts, ["Update links in 2 files?"]);
  await root.dispose();
});
