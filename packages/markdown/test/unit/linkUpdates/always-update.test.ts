import { provideHostServices } from "../../../src/shared/host";
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { linkUpdatesHost } from "../../../src/plugins/linkUpdates/host";
import { metadata } from "../../../src/markdown/metadata";
import { fakeViews, memoryVaults, uriOf, hostWith } from "../views/fakes";

const notes = {
  "Topic/Old.md": "",
  "A.md": "See [[Old|the old note]] and [[Old#Part]].",
  "B.md": "Embed ![[Old]]",
  "C.md": "Unrelated [[A]]",
};

const rename = [
  { oldUri: uriOf("Topic/Old.md"), newUri: uriOf("Topic/New.md") },
];

/** The rename host over an in-memory vault, with settings writes recorded and read back like the real host's. */
async function start(settings: Record<string, unknown> = {}) {
  const { vaults, index, texts } = memoryVaults(notes);
  const fake = fakeViews(settings);
  const root = createRoot();
  root.provide("vaults", vaults);
  const host = hostWith(fake);
  provideHostServices(root, host);
  root.plugin(linkUpdatesHost);
  await root.settled();
  const writes: unknown[][] = [];
  host.settings.access.update = async (key, value, resource, scope) => {
    writes.push([key, value, resource, scope]);
    fake.settings[key] = value;
    return "workspaceFolder";
  };
  const located = await vaults.locate(uriOf("C.md"));
  assert.ok(located);
  return { root, fake, host, index, texts, writes, vault: located.vault };
}

test("Always Update saves the mode for the renamed file's own folder, not for every workspace", async () => {
  const { root, fake, writes } = await start();
  fake.answerWith("Always Update");
  assert.equal((await fake.rename(rename)).length, 2);
  // `narrowest` is the settings service's word for the resource's workspace
  // folder, else the workspace: the choice is about this vault, not the user.
  assert.deepEqual(writes, [
    ["linkUpdates.mode", "always", uriOf("Topic/Old.md"), "narrowest"],
  ]);
  await root.dispose();
});

test("the rename after Always Update does not ask and still rewrites", async () => {
  const { root, fake, writes } = await start();
  fake.answerWith("Always Update");
  await fake.rename(rename);
  // The in-memory vault does not move the file, so the same rename repeats.
  assert.equal((await fake.rename(rename)).length, 2);
  assert.deepEqual(fake.prompts, ["Update links in 2 files?"]);
  assert.equal(writes.length, 1);
  await root.dispose();
});

test("Just updating once and declining never save a mode", async () => {
  const { root, fake, writes } = await start();
  fake.answerWith("Update Links");
  assert.equal((await fake.rename(rename)).length, 2);
  fake.answerWith("Don't Update");
  assert.deepEqual(await fake.rename(rename), []);
  assert.deepEqual(writes, []);
  await root.dispose();
});

test("a mode that cannot be saved does not cost the user the update they asked for", async () => {
  const { root, fake, host } = await start();
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

test("the vault is settled again after the answer, and the edits come from what it holds then", async () => {
  const { root, fake, host, index, texts, vault } = await start();
  const events: string[] = [];
  let parsed = false;
  vault.settled = async () => {
    events.push("settled");
    // The parse queued while the dialog was open finishes on the next settle.
    if (parsed) {
      index.setMetadata("C.md", metadata(texts.get("C.md") ?? ""));
    }
  };
  host.dialogs.ask = async (message) => {
    events.push(message);
    // The user edits C.md while the dialog is open: it now links to Old.
    texts.set("C.md", "Now [[Old]]");
    parsed = true;
    return "Update Links";
  };
  const edits = await fake.rename(rename);
  assert.deepEqual(events, ["settled", "Update links in 2 files?", "settled"]);
  assert.deepEqual(
    edits.map((file) => [file.uri, file.edits.map((edit) => edit.text)]),
    [
      [uriOf("A.md"), ["[[New|the old note]]", "[[New#Part]]"]],
      [uriOf("B.md"), ["![[New]]"]],
      [uriOf("C.md"), ["[[New]]"]],
    ],
  );
  await root.dispose();
});

test("a note that stops linking while the dialog is open is not rewritten", async () => {
  const { root, fake, host, index } = await start();
  host.dialogs.ask = async () => {
    index.setMetadata("B.md", metadata("No link now."));
    return "Update Links";
  };
  const edits = await fake.rename(rename);
  assert.deepEqual(
    edits.map((file) => file.uri),
    [uriOf("A.md")],
  );
  await root.dispose();
});
