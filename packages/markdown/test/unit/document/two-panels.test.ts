import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Transaction } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Session } from "../../../src/plugins/document/session";
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
