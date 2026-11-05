import test from "node:test";
import assert from "node:assert/strict";
import { collab, getSyncedVersion, sendableUpdates } from "@codemirror/collab";
import {
  EditorState,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Synchronizer } from "../../../src/plugins/document/sync";
import { difference } from "../../../src/shared/document/wire";
import type { Endpoint } from "../../../src/shared/rpc/endpoint";

type Log = {
  version: number;
  updates: { clientID: string; changes: unknown[] }[];
};

/** Minimal view: Synchronizer only needs state + dispatch (+ composing for pump). */
function viewWith(doc: string, startVersion = 0): EditorView {
  let state = EditorState.create({
    doc,
    extensions: collab({ clientID: "panel", startVersion }),
  });
  return {
    get state() {
      return state;
    },
    get composing() {
      return false;
    },
    dispatch(...trs: (Transaction | TransactionSpec)[]) {
      for (const tr of trs) {
        state = tr instanceof Transaction ? tr.state : state.update(tr).state;
      }
    },
  } as unknown as EditorView;
}

/** Records requests; a push never completes so the pump sends exactly once. */
function stubRpc(handlers: { catchUp?: (version: number) => Promise<Log> }) {
  const calls: { method: string; params: unknown }[] = [];
  const rpc = {
    call: (_protocol: unknown, method: string, params: unknown) => {
      calls.push({ method, params });
      if (method === "catchUp") {
        return handlers.catchUp!((params as { version: number }).version);
      }
      return new Promise(() => {});
    },
    notify: () => {},
  } as unknown as Endpoint;
  return { rpc, calls };
}

function hostUpdate(before: string, after: string) {
  return { clientID: "host", changes: difference(before, after).toJSON() };
}

const prepended = hostUpdate("base", "intro\nbase");
const appended = hostUpdate("intro\nbase", "intro\nbase\nend");

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("skew asks the host for its log from the synced version and rebases unsent typing", async () => {
  const view = viewWith("base");
  view.dispatch({ changes: { from: 2, insert: "!" } });
  const { rpc, calls } = stubRpc({
    catchUp: async () => ({
      version: 0,
      updates: [prepended, appended],
    }),
  });
  const sync = new Synchronizer(view, rpc, () => {});

  // The host broadcast against version 1; this panel never saw update 0.
  sync.receive({ version: 1, updates: [appended] });
  await settle();

  assert.equal(sync.error, undefined);
  assert.equal(view.state.doc.toString(), "intro\nba!se\nend");
  assert.equal(getSyncedVersion(view.state), 2);
  assert.equal(sendableUpdates(view.state).length, 1);
  // Unsent typing goes out only after catching up, against the host's version.
  assert.deepEqual(
    calls.map((call) => call.method),
    ["catchUp", "push"],
  );
  assert.deepEqual(calls[0]!.params, { version: 0 });
  assert.equal((calls[1]!.params as { version: number }).version, 2);
});

test("a skew with no unsent typing replays the log in place", async () => {
  const view = viewWith("base");
  const { rpc } = stubRpc({
    catchUp: async () => ({ version: 0, updates: [prepended, appended] }),
  });
  const sync = new Synchronizer(view, rpc, () => {});

  sync.receive({ version: 1, updates: [appended] });
  await settle();

  assert.equal(sync.error, undefined);
  assert.equal(view.state.doc.toString(), "intro\nbase\nend");
  assert.equal(getSyncedVersion(view.state), 2);
  assert.equal(sendableUpdates(view.state).length, 0);
});

test("the log may carry another panel's updates", async () => {
  const view = viewWith("base");
  const { rpc } = stubRpc({
    catchUp: async () => ({
      version: 0,
      updates: [
        { clientID: "other", changes: difference("base", "base!").toJSON() },
      ],
    }),
  });
  const sync = new Synchronizer(view, rpc, () => {});

  sync.receive({ version: 1, updates: [] });
  await settle();

  assert.equal(sync.error, undefined);
  assert.equal(view.state.doc.toString(), "base!");
  assert.equal(getSyncedVersion(view.state), 1);
});

test("updates that arrive during a catch-up wait and are not applied twice", async () => {
  const view = viewWith("base");
  let answer!: (log: Log) => void;
  const { rpc, calls } = stubRpc({
    catchUp: () => new Promise<Log>((resolve) => (answer = resolve)),
  });
  const sync = new Synchronizer(view, rpc, () => {});
  const tail = hostUpdate("intro\nbase\nend", "intro\nbase\nend!");

  sync.receive({ version: 1, updates: [appended] });
  // Covered by the log below, then one past it.
  sync.receive({ version: 1, updates: [appended] });
  sync.receive({ version: 2, updates: [tail] });
  assert.equal(view.state.doc.toString(), "base");

  answer({ version: 0, updates: [prepended, appended] });
  await settle();

  assert.equal(sync.error, undefined);
  assert.equal(view.state.doc.toString(), "intro\nbase\nend!");
  assert.equal(getSyncedVersion(view.state), 3);
  assert.equal(calls.filter((call) => call.method === "catchUp").length, 1);
});

test("an update older than the synced version is ignored without a request", async () => {
  const view = viewWith("base");
  const { rpc, calls } = stubRpc({
    catchUp: async () => ({ version: 0, updates: [prepended, appended] }),
  });
  const sync = new Synchronizer(view, rpc, () => {});
  sync.receive({ version: 1, updates: [appended] });
  await settle();
  assert.equal(getSyncedVersion(view.state), 2);
  calls.length = 0;

  sync.receive({ version: 1, updates: [appended] });
  await settle();

  assert.equal(sync.error, undefined);
  assert.equal(calls.length, 0);
  assert.equal(view.state.doc.toString(), "intro\nbase\nend");
});

test("a failed catch-up is loud and keeps the unsent typing visible", async () => {
  const view = viewWith("base");
  view.dispatch({ changes: { from: 4, insert: "!" } });
  const { rpc } = stubRpc({
    catchUp: async () => {
      throw new Error("Unknown document revision.");
    },
  });
  const statuses: string[] = [];
  const sync = new Synchronizer(view, rpc, (message) => statuses.push(message));

  sync.receive({ version: 1, updates: [appended] });
  await settle();

  assert.match(String(sync.error), /Unknown document revision/);
  assert.equal(statuses.at(-1), sync.error);
  assert.equal(view.state.doc.toString(), "base!");
  assert.equal(sendableUpdates(view.state).length, 1);
  await assert.rejects(sync.flush(), /Unknown document revision/);
});

test("an empty log cannot explain a skew and fails with the copy-your-edits error", async () => {
  const view = viewWith("base");
  view.dispatch({ changes: { from: 4, insert: "!" } });
  const { rpc } = stubRpc({
    catchUp: async () => ({ version: 0, updates: [] }),
  });
  const sync = new Synchronizer(view, rpc, () => {});

  sync.receive({ version: 1, updates: [appended] });
  await settle();

  assert.match(String(sync.error), /copy your edits before reopening/);
  assert.equal(view.state.doc.toString(), "base!");
});

test("a log answering another version fails instead of being applied", async () => {
  const view = viewWith("base");
  const { rpc } = stubRpc({
    catchUp: async () => ({ version: 1, updates: [appended] }),
  });
  const sync = new Synchronizer(view, rpc, () => {});

  sync.receive({ version: 1, updates: [appended] });
  await settle();

  assert.match(String(sync.error), /copy your edits before reopening/);
  assert.equal(view.state.doc.toString(), "base");
});

test("a failed synchronizer does not keep asking the host", async () => {
  const view = viewWith("base");
  const { rpc, calls } = stubRpc({
    catchUp: async () => {
      throw new Error("gone");
    },
  });
  const sync = new Synchronizer(view, rpc, () => {});
  sync.receive({ version: 1, updates: [appended] });
  await settle();
  const failure = sync.error;
  calls.length = 0;

  sync.receive({ version: 3, updates: [appended] });
  await settle();

  assert.equal(calls.length, 0);
  assert.equal(sync.error, failure);
});
