import test from "node:test";
import assert from "node:assert/strict";
import { ChangeSet } from "@codemirror/state";
import { Session } from "../../../src/plugins/document/session";
import { protocol } from "../../../src/plugins/document/protocol";
import type { TextEdit } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

/** A note whose workbench applies edits and supports native undo/redo. */
function note(initial: string) {
  let text = initial;
  const done: string[] = [];
  const undone: string[] = [];
  let hashes = 0;
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
    get text() {
      return text;
    },
    get hashes() {
      return hashes;
    },
  };
}

test("typing hashes the note once per push, and undo still restores each group", async () => {
  const doc = note("");
  const pair = rpcPair();
  doc.session.attach("panel", pair.host);
  for (const [at, character] of [
    [0, "a"],
    [1, "b"],
    [2, "c"],
  ] as const) {
    const length = doc.session.text.length;
    await pair.client.call(protocol, "push", {
      version: doc.session.version,
      changes: [
        ChangeSet.of(
          { from: at, insert: character },
          length,
        ).toJSON() as unknown[],
      ],
      group: character,
    });
  }
  assert.equal(doc.text, "abc");
  // One hash for the text before the first push, then one after each push.
  assert.equal(doc.hashes, 4);

  await doc.session.history("undo");
  assert.equal(doc.text, "ab");
  await doc.session.history("undo");
  assert.equal(doc.text, "a");
  await doc.session.history("redo");
  assert.equal(doc.text, "ab");
  await pair.dispose();
});
