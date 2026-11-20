import test from "node:test";
import assert from "node:assert/strict";
import { ChangeSet, type Text } from "@codemirror/state";
import { Session } from "../../../src/plugins/document/session";
import { protocol } from "../../../src/plugins/document/protocol";
import { Authority } from "../../../src/shared/document/authority";
import type { TextEdit } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

/** A note whose workbench applies edits and supports native undo/redo. */
function note(initial: string) {
  let text = initial;
  const done: string[] = [];
  const undone: string[] = [];
  let hashes = 0;
  let natives = 0;
  const host = fakeHost({
    hostDocuments: {
      fingerprint: (value: string) => {
        hashes++;
        return value;
      },
      async apply(_document, edits: readonly TextEdit[]) {
        done.push(text);
        undone.length = 0;
        for (const edit of [...edits].reverse()) {
          text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        }
        session.changed();
        return true;
      },
    },
    hostCommands: {
      async execute(action: string) {
        natives++;
        const [from, to] = action === "undo" ? [done, undone] : [undone, done];
        const previous = from.pop();
        if (previous !== undefined) {
          to.push(text);
          text = previous;
          session.changed();
        }
      },
    },
  });
  const session = new Session(fakeDocument({ getText: () => text }), host);
  return {
    session,
    done,
    get text() {
      return text;
    },
    get hashes() {
      return hashes;
    },
    get natives() {
      return natives;
    },
  };
}

async function type(
  doc: ReturnType<typeof note>,
  client: ReturnType<typeof rpcPair>["client"],
  inserts: readonly (readonly [number, string, string])[],
): Promise<void> {
  for (const [at, character, group] of inserts) {
    const length = doc.session.text.length;
    await client.call(protocol, "push", {
      version: doc.session.version,
      changes: [
        ChangeSet.of(
          { from: at, insert: character },
          length,
        ).toJSON() as unknown[],
      ],
      group,
    });
  }
}

test("typing hashes nothing, and undo still restores each group", async () => {
  const doc = note("");
  const pair = rpcPair();
  doc.session.attach("panel", pair.host);
  await type(doc, pair.client, [
    [0, "a", "a"],
    [1, "b", "b"],
    [2, "c", "c"],
  ]);
  assert.equal(doc.text, "abc");
  await doc.session.history("undo");
  assert.equal(doc.text, "ab");
  await doc.session.history("undo");
  assert.equal(doc.text, "a");
  await doc.session.history("redo");
  assert.equal(doc.text, "ab");
  assert.equal(doc.hashes, 0);
  await pair.dispose();
});

test("one undo replays a whole group, each step checked against its start", async () => {
  const doc = note("");
  const pair = rpcPair();
  doc.session.attach("panel", pair.host);
  await type(doc, pair.client, [
    [0, "x", "word"],
    [1, "y", "word"],
    [2, "z", "word"],
  ]);
  await doc.session.history("undo");
  assert.equal(doc.text, "");
  assert.equal(doc.natives, 3);
  await doc.session.history("redo");
  assert.equal(doc.text, "xyz");
  await pair.dispose();
});

test("a native undo that does not land on the group's start stops the group", async () => {
  const doc = note("");
  const pair = rpcPair();
  doc.session.attach("panel", pair.host);
  await type(doc, pair.client, [
    [0, "x", "word"],
    [1, "y", "word"],
    [2, "z", "word"],
  ]);
  // The workbench's history no longer matches: its step restores other text,
  // which reaches the session as a new version like any undo would.
  doc.done[doc.done.length - 1] = "other";
  await doc.session.history("undo");
  assert.equal(doc.text, "other");
  assert.equal(doc.natives, 1);
  await pair.dispose();
});

test("text the host reports keeps the unchanged parts of the previous text", () => {
  const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
  const authority = new Authority(lines.join("\n"));
  const before = authority.doc;
  lines[2500] = "changed";
  authority.record(lines.join("\n"));
  assert.equal(authority.doc.toString(), lines.join("\n"));
  // Undo checkpoints hold these texts: unchanged leaves must be shared, or
  // each checkpoint would keep a whole copy of the note.
  const leaves = (text: Text) =>
    (text as unknown as { children: Text[] }).children ?? [];
  const shared = leaves(authority.doc).filter((child) =>
    leaves(before).includes(child),
  );
  assert.ok(shared.length > 0);
});
