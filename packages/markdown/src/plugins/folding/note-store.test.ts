import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { provideHostServices, type PanelShell } from "../../shared/host";
import type { WorkspaceStorage } from "../../shared/host";
import { fakeHost } from "../../../test/support/vscode-fake";
import { rpcPair } from "../../../test/support/rpc-pair";
import { MAX_NOTES, NoteFoldStore } from "./note-store";
import { foldingHost } from "./host";
import { protocol } from "./protocol";

function memoryStorage(): WorkspaceStorage & { saved: Map<string, unknown> } {
  const saved = new Map<string, unknown>();
  return {
    saved,
    get<T>(key: string, fallback: T): T {
      return (saved.get(key) as T) ?? fallback;
    },
    async update(key, value) {
      saved.set(key, value);
    },
  };
}

const NOTE = "file:///vault/Note.md";
const heading = { from: 5, to: 16, edges: ["# One", "first body"] };
const list = { from: 30, to: 40, edges: ["- item", "  child"] };

test("the note's folds are those of the panel the reader last folded in", async () => {
  const store = new NoteFoldStore(memoryStorage());
  const first = {};
  const second = {};
  store.open(NOTE, first);
  store.open(NOTE, second);
  assert.equal(store.read(NOTE), undefined);
  assert.equal(
    await store.save(NOTE, first, { folds: [heading], claim: true }),
    true,
  );
  assert.equal(
    await store.save(NOTE, second, { folds: [list], claim: true }),
    true,
  );
  assert.deepEqual(store.read(NOTE), [list]);
  // The first panel's text changed: its folds are no longer the note's.
  assert.equal(
    await store.save(NOTE, first, { folds: [heading], claim: false }),
    false,
  );
  assert.deepEqual(store.read(NOTE), [list]);
  // The writer's own update after a text change is taken.
  const moved = { ...list, from: 31, to: 41 };
  assert.equal(
    await store.save(NOTE, second, { folds: [moved], claim: false }),
    true,
  );
  assert.deepEqual(store.read(NOTE), [moved]);
});

test("the first panel to open a note keeps its record; closing one keeps it", async () => {
  const store = new NoteFoldStore(memoryStorage());
  const first = {};
  const second = {};
  store.open(NOTE, first);
  store.open(NOTE, second);
  assert.equal(
    await store.save(NOTE, second, { folds: [list], claim: false }),
    false,
  );
  assert.equal(
    await store.save(NOTE, first, { folds: [heading], claim: false }),
    true,
  );
  store.close(NOTE, first);
  assert.deepEqual(store.read(NOTE), [heading]);
  // Nobody holds the record: the next panel opened takes it.
  const third = {};
  store.open(NOTE, third);
  assert.equal(
    await store.save(NOTE, third, { folds: [], claim: false }),
    true,
  );
  assert.deepEqual(store.read(NOTE), []);
});

test("only the most recently saved notes are kept, and malformed records are none", async () => {
  const storage = memoryStorage();
  const store = new NoteFoldStore(storage);
  const panel = {};
  for (let index = 0; index <= MAX_NOTES; index++) {
    await store.save(`file:///vault/${index}.md`, panel, {
      folds: [heading],
      claim: true,
    });
  }
  assert.equal(store.read("file:///vault/0.md"), undefined);
  assert.deepEqual(store.read(`file:///vault/${MAX_NOTES}.md`), [heading]);
  assert.equal(
    Object.keys(storage.saved.get("markdownNoteFolds") as object).length,
    MAX_NOTES,
  );
  storage.saved.set("markdownNoteFolds", { [NOTE]: [{ from: 4, to: 2 }] });
  assert.equal(store.read(NOTE), undefined);
});

test("a fold in panel A is folded in panel B when B opens the note", async (t) => {
  const storage = memoryStorage();
  const open = async () => {
    const pair = rpcPair();
    t.after(() => pair.dispose());
    const root = createRoot();
    root.provide("rpc", pair.host);
    provideHostServices(root, fakeHost({ storage }));
    const fiber = root.plugin(foldingHost, {
      panel: { document: { uri: NOTE } } as PanelShell,
    });
    await root.settled();
    return { client: pair.client, fiber };
  };
  const a = await open();
  assert.deepEqual(await a.client.call(protocol, "load", {}), {});
  assert.equal(
    await a.client.call(protocol, "save", { folds: [heading], claim: true }),
    true,
  );
  const b = await open();
  assert.deepEqual(await b.client.call(protocol, "load", {}), {
    folds: [heading],
  });
  // B's update after a text change does not replace A's folds.
  assert.equal(
    await b.client.call(protocol, "save", { folds: [], claim: false }),
    false,
  );
  await assert.rejects(
    a.client.call(protocol, "save", {
      folds: [{ from: 9, to: 3 }],
      claim: true,
    }),
  );
  // Closing A leaves its folds as the note's for the next panel.
  await a.fiber.dispose();
  const c = await open();
  assert.deepEqual(await c.client.call(protocol, "load", {}), {
    folds: [heading],
  });
});
