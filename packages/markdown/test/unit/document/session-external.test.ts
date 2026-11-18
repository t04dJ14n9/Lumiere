import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type { HostDocument } from "../../../src/shared/host";
import { Session } from "../../../src/plugins/document/session";
import { documentHost } from "../../../src/plugins/document/host";
import { protocol } from "../../../src/plugins/document/protocol";
import type { Endpoint } from "../../../src/shared/rpc/endpoint";
import type {
  Documents,
  DocumentSession,
} from "../../../src/plugins/document/api";
import type { UndoGroups } from "../../../src/plugins/document/undo-groups";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

type SessionInternals = {
  groups: UndoGroups;
  saveEcho?: string;
};

function internals(session: DocumentSession): SessionInternals {
  return session as unknown as SessionInternals;
}

test("own save echo does not clear UndoGroups", async () => {
  let text = "note";
  let saved = "note";
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return text !== saved;
    },
    async save() {
      saved = text;
      return true;
    },
  });
  const clears: string[] = [];
  const session = new Session(doc, fakeHost());
  const groups = internals(session).groups;
  const clear = groups.clear.bind(groups);
  internals(session).groups.clear = () => {
    clears.push("clear");
    clear();
  };
  groups.record("note", "note!");
  text = "note!";
  session.changed(); // may clear; reset:
  clears.length = 0;
  groups.record("note", "note!");
  await session.save();
  session.changed(); // echo
  assert.deepEqual(clears, []);
});

test("native hostDocuments.onSave arms saveEcho without Session.save", async () => {
  let text = "note";
  let saved = "note";
  let onSave: ((document: HostDocument) => void) | undefined;
  const host = fakeHost({
    hostDocuments: {
      onSave(listener) {
        onSave = listener;
        return () => {};
      },
    },
  });
  const root = createRoot();
  provideHostServices(root, host);
  root.plugin(documentHost);
  await root.settled();
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return text !== saved;
    },
    async save() {
      saved = text;
      return true;
    },
  });
  const session = (root.service("documents") as Documents).session(doc);
  const clears: string[] = [];
  const groups = internals(session).groups;
  const clear = groups.clear.bind(groups);
  internals(session).groups.clear = () => {
    clears.push("clear");
    clear();
  };
  // Host edit lands without Session.save — authority still "note".
  text = "note!";
  groups.record("note", "note!");
  // Native Ctrl+S / File→Save fires onSave only (not Session.save).
  assert.equal(
    typeof onSave,
    "function",
    "documentHost must subscribe to hostDocuments.onSave",
  );
  onSave!(doc);
  assert.equal(internals(session).saveEcho, "note!");
  session.changed(); // rewrite-bytes echo: host text === saveEcho, ≠ authority
  assert.deepEqual(clears, []);
  assert.equal(internals(session).saveEcho, undefined);
  assert.equal(session.text, "note!");
  await root.dispose();
});

test("saveEcho rewrite-bytes path keeps UndoGroups when text differs from authority", () => {
  let text = "note";
  const doc = fakeDocument({
    getText: () => text,
  });
  const clears: string[] = [];
  const session = new Session(doc, fakeHost());
  const groups = internals(session).groups;
  const clear = groups.clear.bind(groups);
  internals(session).groups.clear = () => {
    clears.push("clear");
    clear();
  };
  groups.record("note", "note!");
  // Simulate host onSave → markSaved(doc.getText()) while authority lags.
  text = "note!";
  session.markSaved(text);
  session.changed();
  assert.deepEqual(clears, []);
  assert.equal(internals(session).saveEcho, undefined);
  assert.equal(session.text, "note!");
});

test("clean external rewrite does not clear UndoGroups", () => {
  let text = "base";
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return false;
    },
  });
  const session = new Session(doc, fakeHost());
  const groups = internals(session).groups;
  const clears: string[] = [];
  const clear = groups.clear.bind(groups);
  internals(session).groups.clear = () => {
    clears.push("clear");
    clear();
  };
  groups.record("base", "base");
  // Stale armed echo must not survive a real host rewrite.
  session.markSaved("stale-echo");
  assert.equal(internals(session).saveEcho, "stale-echo");
  text = "external";
  session.changed();
  assert.deepEqual(clears, []);
  assert.equal(session.text, "external");
  assert.equal(internals(session).saveEcho, undefined);
  assert.equal(session.authority.since(0).at(-1)?.clientID, "host");
});

test("dirty unexpected host rewrite clears stale saveEcho", () => {
  let text = "base";
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return true;
    },
  });
  const session = new Session(doc, fakeHost());
  session.markSaved("stale-echo");
  text = "external-dirty";
  session.changed();
  assert.equal(internals(session).saveEcho, undefined);
  assert.equal(session.text, "external-dirty");
});

/** Captures what the host puts on the wire, before any schema can strip it. */
function recordingPanel() {
  const sent: { version: number; updates: unknown[] }[] = [];
  const rpc = {
    handle: () => () => {},
    notify: (_protocol: unknown, _method: string, params: never) => {
      sent.push(params);
    },
  } as unknown as Endpoint;
  return { rpc, sent };
}

test("update broadcasts carry the changes, never the document text", () => {
  const huge = "x".repeat(900_000);
  let text = huge;
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return false;
    },
  });
  const session = new Session(doc, fakeHost());
  const first = recordingPanel();
  const second = recordingPanel();
  session.attach("first", first.rpc);
  session.attach("second", second.rpc);

  text = `${huge.slice(0, 10)}y${huge.slice(11)}`;
  session.changed();

  for (const panel of [first, second]) {
    assert.equal(panel.sent.length, 1);
    assert.deepEqual(Object.keys(panel.sent[0]!).sort(), [
      "updates",
      "version",
    ]);
    assert.ok(panel.sent[0]!.updates.length > 0);
    assert.ok(JSON.stringify(panel.sent[0]).length < 1000);
  }
  assert.equal(session.text, text);
});

test("an oversized clean external rewrite still delivers its updates", async () => {
  let text = "base";
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return false;
    },
  });
  const session = new Session(doc, fakeHost());
  const pair = rpcPair();
  const messages: { version: number; updates: unknown[] }[] = [];
  pair.client.on(protocol, "updates", (message) => {
    messages.push(message);
  });
  session.attach("panel", pair.host);

  const oversize = "x".repeat(1_000_001);
  text = oversize;
  session.changed();

  assert.equal(messages.length, 1);
  assert.ok(messages[0]!.updates.length > 0);
  assert.equal(session.text, oversize);
  await pair.dispose();
});

test("a dirty change by another extension is recorded as the document has it, never merged back", () => {
  let text = "a\nb\nc";
  const applied: unknown[] = [];
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return true;
    },
  });
  const session = new Session(
    doc,
    fakeHost({
      hostDocuments: {
        apply: async (...args) => {
          applied.push(args);
          return true;
        },
      },
    }),
  );
  const panel = recordingPanel();
  session.attach("panel", panel.rpc);

  // A formatter rewrites the line the user has unsaved edits in.
  text = "a\nB\nc";
  session.changed();
  text = "a\nB\nc\nend";
  session.changed();

  assert.equal(session.text, "a\nB\nc\nend");
  assert.deepEqual(applied, []);
  // Each broadcast is against the version the panel was at: the log only grows.
  assert.deepEqual(
    panel.sent.map((message) => message.version),
    [0, 1],
  );
  assert.equal(session.version, 2);
  assert.ok(session.authority.since(0).every((u) => u.clientID === "host"));
});
