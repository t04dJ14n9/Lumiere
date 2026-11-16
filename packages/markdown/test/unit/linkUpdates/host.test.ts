import { provideHostServices } from "../../../src/shared/host";
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import {
  linkUpdatesHost,
  settledWithin,
} from "../../../src/plugins/linkUpdates/host";
import { metadata } from "../../../src/markdown/metadata";
import { fakeViews, memoryVaults, uriOf, hostWith } from "../views/fakes";

const notes = {
  "Topic/Old.md": "",
  "A.md": "See [[Old|the old note]] and [[Old#Part]].",
  "B.md": "Embed ![[Old]]",
  "C.md": "Unrelated [[A]]",
};

async function start(
  settings: Record<string, unknown> = {},
  extraNotes: Record<string, string> = {},
) {
  const { vaults, index, texts } = memoryVaults({ ...notes, ...extraNotes });
  const fake = fakeViews(settings);
  const root = createRoot();
  root.provide("vaults", vaults);
  const host = hostWith(fake);
  provideHostServices(root, host);
  root.plugin(linkUpdatesHost);
  await root.settled();
  return { root, fake, host, vaults, index, texts };
}

const rename = [
  { oldUri: uriOf("Topic/Old.md"), newUri: uriOf("Topic/New.md") },
];

test("a rename asks once and returns one edit list for every linking note", async () => {
  const { root, fake } = await start();
  fake.answerWith("Update Links");
  const edits = await fake.rename(rename);
  assert.deepEqual(fake.prompts, ["Update links in 2 files?"]);
  assert.deepEqual(
    edits.map((file) => [file.uri, file.edits.map((edit) => edit.text)]),
    [
      [uriOf("A.md"), ["[[New|the old note]]", "[[New#Part]]"]],
      [uriOf("B.md"), ["![[New]]"]],
    ],
  );
  await root.dispose();
});

test("declining, or the never mode, changes nothing; always does not ask", async () => {
  const declined = await start();
  declined.fake.answerWith("Don't Update");
  assert.deepEqual(await declined.fake.rename(rename), []);
  await declined.root.dispose();

  const never = await start({ "linkUpdates.mode": "never" });
  assert.deepEqual(await never.fake.rename(rename), []);
  assert.deepEqual(never.fake.prompts, []);
  await never.root.dispose();

  const always = await start({ "linkUpdates.mode": "always" });
  assert.equal((await always.fake.rename(rename)).length, 2);
  assert.deepEqual(always.fake.prompts, []);
  await always.root.dispose();
});

test("renaming a folder updates links to every file in it", async () => {
  const { root, fake } = await start({
    "linkUpdates.mode": "always",
    "links.newLinkFormat": "absolute",
  });
  const edits = await fake.rename([
    { oldUri: uriOf("Topic"), newUri: uriOf("Subject") },
  ]);
  assert.deepEqual(
    edits.flatMap((file) => file.edits.map((edit) => edit.text)),
    [
      "[[Subject/Old|the old note]]",
      "[[Subject/Old#Part]]",
      "![[Subject/Old]]",
    ],
  );
  await root.dispose();
});

test("edits are computed from the open document, not a stale vault copy", async () => {
  const { root, fake, host } = await start({ "linkUpdates.mode": "always" });
  const open = '---\nrelated: "[[Old]]"\n---\nNew line [[Old|the old note]].';
  host.hostDocuments.text = (uri) => (uri === uriOf("A.md") ? open : undefined);
  const edits = await fake.rename(rename);
  const a = edits.find((file) => file.uri === uriOf("A.md"));
  assert.deepEqual(
    a?.edits
      .map((edit) => [edit.start.line, edit.start.col, edit.text])
      .sort((x, y) => Number(x[0]) - Number(y[0])),
    [
      [1, 10, "[[New]]"],
      [3, 9, "[[New|the old note]]"],
    ],
  );
  await root.dispose();
});

test("a rename waits for queued parses before reading backlinks", async () => {
  const { root, fake, vaults, index, texts } = await start({
    "linkUpdates.mode": "always",
  });
  const located = await vaults.locate(uriOf("C.md"));
  assert.ok(located);
  // C.md's new link to Old is still queued when the rename starts.
  texts.set("C.md", "Now [[Old]]");
  located.vault.settled = async () => {
    index.setMetadata("C.md", metadata("Now [[Old]]"));
  };
  const edits = await fake.rename(rename);
  assert.deepEqual(
    edits.map((file) => file.uri),
    [uriOf("A.md"), uriOf("B.md"), uriOf("C.md")],
  );
  await root.dispose();
});

test("settledWithin stops waiting at the limit", async () => {
  const started = Date.now();
  await settledWithin({ settled: () => new Promise<void>(() => {}) }, 20);
  assert.ok(Date.now() - started < 1_000);
  let settled = false;
  await settledWithin(
    {
      settled: async () => {
        settled = true;
      },
    },
    60_000,
  );
  assert.equal(settled, true);
});

test("Always Update rewrites the links and stops asking for that note", async () => {
  const { root, fake, host } = await start();
  const writes: unknown[][] = [];
  host.settings.access.update = async (key, value, resource, scope) => {
    writes.push([key, value, resource, scope]);
    return "workspaceFolder";
  };
  fake.answerWith("Always Update");
  assert.equal((await fake.rename(rename)).length, 2);
  assert.deepEqual(writes, [
    ["linkUpdates.mode", "always", uriOf("Topic/Old.md"), "workspaceFolder"],
  ]);
  await root.dispose();
});

test("the edits are built from the text as it is when the dialog is answered", async () => {
  const { root, fake, host } = await start();
  const typed = "Typed during the dialog: [[Old]]";
  host.dialogs.ask = async () => {
    host.hostDocuments.text = (uri) =>
      uri === uriOf("A.md") ? typed : undefined;
    return "Update Links";
  };
  const edits = await fake.rename(rename);
  const a = edits.find((file) => file.uri === uriOf("A.md"));
  assert.deepEqual(
    a?.edits.map((edit) => [edit.start.line, edit.start.col, edit.text]),
    [[0, 25, "[[New]]"]],
  );
  await root.dispose();
});

test("a case-only rename rewrites the links to the new spelling", async () => {
  const { root, fake } = await start({ "linkUpdates.mode": "always" });
  const edits = await fake.rename([
    { oldUri: uriOf("Topic/Old.md"), newUri: uriOf("Topic/old.md") },
  ]);
  assert.deepEqual(
    edits.map((file) => [file.uri, file.edits.map((edit) => edit.text)]),
    [
      [uriOf("A.md"), ["[[old|the old note]]", "[[old#Part]]"]],
      [uriOf("B.md"), ["![[old]]"]],
    ],
  );
  await root.dispose();
});

test("the prompt counts from the index and the answer is followed by the only rewrite pass", async () => {
  const { root, fake, host } = await start();
  const reads: string[] = [];
  host.hostDocuments.text = (uri) => {
    reads.push(uri);
    return undefined;
  };
  const prompted: string[][] = [];
  host.dialogs.ask = async (message) => {
    prompted.push([message, ...reads]);
    return "Update Links";
  };
  const edits = await fake.rename(rename);
  // Nothing was read to build the question: that is left to the answer.
  assert.deepEqual(prompted, [["Update links in 2 files?"]]);
  // Each candidate note was read once, so the rewrite ran once.
  assert.deepEqual(
    [...reads].sort(),
    [uriOf("A.md"), uriOf("B.md"), uriOf("Topic/Old.md")].sort(),
  );
  assert.equal(edits.length, 2);
  await root.dispose();
});

test("the prompt counts the notes the rename would change, as a folder rename does", async () => {
  const { root, fake } = await start();
  fake.answerWith("Update Links");
  const edits = await fake.rename([
    { oldUri: uriOf("Topic"), newUri: uriOf("Subject") },
  ]);
  assert.deepEqual(fake.prompts, ["Update links in 2 files?"]);
  assert.equal(edits.length, 2);
  await root.dispose();
});

test("a rename that changes no link does not ask", async () => {
  const { root, fake } = await start();
  fake.answerWith("Update Links");
  // Nothing links to C.md, and its own link is not path-style.
  const edits = await fake.rename([
    { oldUri: uriOf("C.md"), newUri: uriOf("Topic/C.md") },
  ]);
  assert.deepEqual(fake.prompts, []);
  assert.deepEqual(edits, []);
  await root.dispose();
});

test("moving a note asks about its own path-style links", async () => {
  const { root, fake } = await start({}, { "D.md": "From [[Topic/Old]]." });
  fake.answerWith("Update Links");
  const edits = await fake.rename([
    { oldUri: uriOf("D.md"), newUri: uriOf("Sub/D.md") },
  ]);
  assert.deepEqual(fake.prompts, ["Update links in 1 file?"]);
  assert.deepEqual(
    edits.map((file) => file.uri),
    [uriOf("D.md")],
  );
  await root.dispose();
});

test("a moved note the index has not parsed still asks about its own links", async () => {
  const { root, fake, index } = await start(
    {},
    { "D.md": "From [[Topic/Old]]." },
  );
  // The settle timed out before D.md was parsed: the index knows no links
  // for it, but its text does.
  index.setMetadata("D.md", undefined);
  fake.answerWith("Update Links");
  const edits = await fake.rename([
    { oldUri: uriOf("D.md"), newUri: uriOf("Sub/D.md") },
  ]);
  assert.deepEqual(fake.prompts, ["Update links in 1 file?"]);
  assert.deepEqual(
    edits.map((file) => [file.uri, file.edits.map((edit) => edit.text)]),
    [[uriOf("D.md"), ["[[Old]]"]]],
  );
  await root.dispose();
});

test("a moved note the index has not parsed and that links nothing does not ask", async () => {
  const { root, fake, index } = await start({}, { "D.md": "Nothing here." });
  index.setMetadata("D.md", undefined);
  fake.answerWith("Update Links");
  const edits = await fake.rename([
    { oldUri: uriOf("D.md"), newUri: uriOf("Sub/D.md") },
  ]);
  assert.deepEqual(fake.prompts, []);
  assert.deepEqual(edits, []);
  await root.dispose();
});
