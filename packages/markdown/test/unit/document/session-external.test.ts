import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type { HostDocument } from "../../../src/shared/host";
import { Session } from "../../../src/plugins/document/session";
import { documentHost } from "../../../src/plugins/document/host";
import type { Documents } from "../../../src/plugins/document/api";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

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
  const groups = (session as any).groups;
  const clear = groups.clear.bind(groups);
  groups.clear = () => {
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
  assert.equal((session as any).lastSaved, "note!");
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
  const groups = (session as any).groups;
  const clear = groups.clear.bind(groups);
  groups.clear = () => {
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
  assert.equal((session as any).saveEcho, "note!");
  assert.equal((session as any).lastSaved, "note!");
  session.changed(); // rewrite-bytes echo: host text === saveEcho, ≠ authority
  assert.deepEqual(clears, []);
  assert.equal((session as any).saveEcho, undefined);
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
  const groups = (session as any).groups;
  const clear = groups.clear.bind(groups);
  groups.clear = () => {
    clears.push("clear");
    clear();
  };
  groups.record("note", "note!");
  // Simulate host onSave → markSaved(doc.getText()) while authority lags.
  text = "note!";
  session.markSaved(text);
  session.changed();
  assert.deepEqual(clears, []);
  assert.equal((session as any).saveEcho, undefined);
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
  const groups = (session as any).groups;
  const clears: string[] = [];
  const clear = groups.clear.bind(groups);
  groups.clear = () => {
    clears.push("clear");
    clear();
  };
  groups.record("base", "base");
  // Stale armed echo must not survive a real host rewrite.
  session.markSaved("stale-echo");
  assert.equal((session as any).saveEcho, "stale-echo");
  text = "external";
  session.changed();
  assert.deepEqual(clears, []);
  assert.equal(session.text, "external");
  assert.equal((session as any).lastSaved, "external");
  assert.equal((session as any).saveEcho, undefined);
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
  assert.equal((session as any).saveEcho, undefined);
  assert.equal(session.text, "external-dirty");
});
