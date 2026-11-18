import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { attachmentsHost } from "../../../src/plugins/attachments/host";
import type { AfterDelete, HostDocuments } from "../../../src/shared/host";
import { provideHostServices } from "../../../src/shared/host";
import { fakeHost } from "../../support/vscode-fake";
import { memoryVaults, uriOf } from "../views/fakes";

const KEY = "attachments.deleteUnlinkedAttachments";

type WillDelete = Parameters<HostDocuments["onWillDelete"]>[0];

interface Setup {
  /** `attachments.deleteUnlinkedAttachments`; unset is the default, ask. */
  mode?: string;
  /** What the person picks when asked. */
  answer?: string;
  /** A path whose removal fails. */
  failing?: string;
}

/**
 * The attachments plugin over a vault where A.md alone links only-a.png, and
 * A.md and B.md both link shared.png.
 */
async function fixture({ mode, answer, failing }: Setup = {}) {
  const asked: { message: string; actions: readonly string[] }[] = [];
  const removed: { uri: string; trash: boolean | undefined }[] = [];
  const updates: unknown[][] = [];
  const errors: string[] = [];
  const settings: Record<string, unknown> =
    mode === undefined ? {} : { [KEY]: mode };
  let willDelete: WillDelete | undefined;
  const { vaults } = memoryVaults({
    "A.md": "![[only-a.png]] ![[shared.png]]",
    "B.md": "![[shared.png]]",
    "only-a.png": "",
    "shared.png": "",
  });
  const root = createRoot();
  provideHostServices(
    root,
    fakeHost({
      hostDocuments: {
        onWillDelete(listener) {
          willDelete = listener;
          return () => {};
        },
      },
      dialogs: {
        async ask(message, actions) {
          asked.push({ message, actions });
          return answer;
        },
        error: (message) => errors.push(message),
      },
      settings: {
        get: <T>(key: string, fallback: T) =>
          (key in settings ? settings[key] : fallback) as T,
        access: {
          ...fakeHost().settings.access,
          async update(key, value, resource) {
            updates.push([key, value, resource]);
            return "user";
          },
        },
      },
      workspace: {
        files: {
          ...fakeHost().workspace.files,
          async remove(uri, options) {
            if (uri === failing) {
              throw new Error("busy");
            }
            removed.push({ uri, trash: options?.trash });
          },
        },
      },
    }),
  );
  root.provide("vaults", vaults);
  root.provide("editors", { all: () => [], active: () => undefined } as never);
  root.plugin(attachmentsHost);
  await root.settled();
  return {
    /** VS Code is about to delete these URIs. */
    deleting: (...uris: string[]): Promise<AfterDelete | undefined> =>
      Promise.resolve(willDelete!(uris)),
    asked,
    removed,
    updates,
    errors,
    dispose: () => root.dispose(),
  };
}

test("never offers nothing", async () => {
  const run = await fixture({ mode: "never" });
  assert.equal(await run.deleting(uriOf("A.md")), undefined);
  assert.deepEqual(run.asked, []);
  await run.dispose();
});

test("ask lists what only the deleted note used, once the note is gone", async () => {
  const run = await fixture({ answer: "Delete" });
  const after = await run.deleting(uriOf("A.md"));
  assert.equal(run.asked.length, 0, "nothing is asked while the note exists");
  await after!();
  assert.equal(run.asked.length, 1);
  assert.match(run.asked[0]!.message, /only-a\.png/);
  assert.doesNotMatch(run.asked[0]!.message, /shared\.png/);
  assert.deepEqual(run.asked[0]!.actions, [
    "Delete",
    "Always Delete",
    "Never Delete",
  ]);
  assert.deepEqual(run.removed, [{ uri: uriOf("only-a.png"), trash: true }]);
  await run.dispose();
});

test("dismissing the question keeps the attachments", async () => {
  const run = await fixture({ mode: "ask" });
  await (await run.deleting(uriOf("A.md")))!();
  assert.deepEqual(run.removed, []);
  assert.deepEqual(run.updates, []);
  await run.dispose();
});

test("Always Delete deletes and stops asking; Never Delete keeps and stops offering", async () => {
  const always = await fixture({ answer: "Always Delete" });
  await (await always.deleting(uriOf("A.md")))!();
  assert.deepEqual(always.updates, [[KEY, "always", uriOf("A.md")]]);
  assert.equal(always.removed.length, 1);
  await always.dispose();
  const never = await fixture({ answer: "Never Delete" });
  await (await never.deleting(uriOf("A.md")))!();
  assert.deepEqual(never.updates, [[KEY, "never", uriOf("A.md")]]);
  assert.deepEqual(never.removed, []);
  await never.dispose();
});

test("always deletes without asking, and frees what several notes alone shared", async () => {
  const run = await fixture({ mode: "always" });
  await (await run.deleting(uriOf("A.md"), uriOf("B.md")))!();
  assert.deepEqual(run.asked, []);
  assert.deepEqual(run.removed.map((item) => item.uri).sort(), [
    uriOf("only-a.png"),
    uriOf("shared.png"),
  ]);
  assert.ok(run.removed.every((item) => item.trash));
  await run.dispose();
});

test("a note that frees nothing, or lies outside every vault, offers nothing", async () => {
  const run = await fixture({ mode: "always" });
  assert.equal(await run.deleting(uriOf("B.md")), undefined);
  assert.equal(await run.deleting("memory:///elsewhere/Note.md"), undefined);
  await run.dispose();
});

test("an attachment that cannot be deleted is reported, and the rest still go", async () => {
  const run = await fixture({
    mode: "always",
    failing: uriOf("only-a.png"),
  });
  await (await run.deleting(uriOf("A.md"), uriOf("B.md")))!();
  assert.deepEqual(
    run.removed.map((item) => item.uri),
    [uriOf("shared.png")],
  );
  assert.equal(run.errors.length, 1);
  assert.match(run.errors[0]!, /only-a\.png/);
  await run.dispose();
});
