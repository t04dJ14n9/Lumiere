import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Transaction } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Session } from "../../../src/plugins/document/session";
import { mergeDiskChange } from "../../../src/shared/document/merge";
import { protocol } from "../../../src/plugins/document/protocol";
import { ViewConnection } from "../../../src/plugins/document/view-connection";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

/** Just enough of an EditorView for ViewConnection and its Synchronizer. */
function fakeView(doc: string, extensions: unknown) {
  const view = {
    state: EditorState.create({ doc, extensions: extensions as never }),
    composing: false,
    hasFocus: false,
    dom: { addEventListener() {}, setAttribute() {} },
    dispatch(change: Transaction | TransactionSpec) {
      const transaction =
        change instanceof Transaction ? change : view.state.update(change);
      view.state = transaction.state;
    },
  };
  return view;
}

/** One panel of the note: its endpoint pair, connection and view. */
async function openPanel(session: Session, id: string) {
  const pair = rpcPair();
  const connection = new ViewConnection(
    { version: session.version, clientID: id },
    pair.client,
    () => {},
  );
  pair.client.on(protocol, "updates", (message) => connection.receive(message));
  const view = fakeView(session.text, connection.extension);
  connection.attach(view as unknown as EditorView);
  await session.attach(id, pair.host);
  return { pair, connection, view };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test("an edit on one panel arrives on the other panel of the same note", async () => {
  let text = "base";
  const doc = fakeDocument({ getText: () => text });
  const host = fakeHost({
    hostDocuments: {
      async apply(_document, edits) {
        for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
          text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        }
        return true;
      },
    },
  });
  const session = new Session(doc, host);
  const a = await openPanel(session, "A");
  const b = await openPanel(session, "B");

  a.view.dispatch({ changes: { from: 4, insert: " edited on A" } });
  a.connection.pump();
  await settle();

  assert.equal(text, "base edited on A");
  assert.equal(session.text, "base edited on A");
  assert.equal(b.view.state.doc.toString(), "base edited on A");
  // A's own edit is confirmed, not applied twice.
  assert.equal(a.view.state.doc.toString(), "base edited on A");
  assert.equal(b.connection.error, undefined);

  // An external change reaches both panels.
  text = "rewritten outside";
  session.changed();
  await settle();
  assert.equal(a.view.state.doc.toString(), "rewritten outside");
  assert.equal(b.view.state.doc.toString(), "rewritten outside");

  a.connection.dispose();
  b.connection.dispose();
  await a.pair.dispose();
  await b.pair.dispose();
});

test("an outside rewrite merged into unsaved text reaches both panels and rebases typing not yet sent", async () => {
  let text = "a\nb\nc";
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return text !== "a\nb\nc";
    },
  });
  const host = fakeHost({
    hostDocuments: {
      async apply(_document, edits) {
        for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
          text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        }
        return true;
      },
    },
  });
  const session = new Session(doc, host);
  const a = await openPanel(session, "A");
  const b = await openPanel(session, "B");

  a.view.dispatch({ changes: { from: 0, to: 1, insert: "A" } });
  a.connection.pump();
  await settle();
  assert.equal(text, "A\nb\nc");

  // Typing on A that the host has not received when the file changes.
  a.view.dispatch({ changes: { from: 5, insert: "!" } });
  // What the host does when another program rewrites the file: merge the
  // unsaved text into it, then report the merged text as the document's.
  text = mergeDiskChange({
    saved: "a\nb\nc",
    buffer: text,
    disk: "a\nb\nC",
  });
  session.changed();
  await settle();

  // The outside change and A's typing both end up everywhere, once.
  for (const converged of [
    text,
    session.text,
    a.view.state.doc.toString(),
    b.view.state.doc.toString(),
  ]) {
    assert.equal(converged, "A\nb\nC!");
  }
  assert.equal(a.connection.error, undefined);
  assert.equal(b.connection.error, undefined);

  a.connection.dispose();
  b.connection.dispose();
  await a.pair.dispose();
  await b.pair.dispose();
});
