import test from "node:test";
import assert from "node:assert/strict";
import { collab, sendableUpdates } from "@codemirror/collab";
import {
  EditorState,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Session } from "../../../src/plugins/document/session";
import { Synchronizer } from "../../../src/plugins/document/sync";
import { ViewConnection } from "../../../src/plugins/document/view-connection";
import { protocol } from "../../../src/plugins/document/protocol";
import { callFailed, type Endpoint } from "../../../src/shared/rpc/endpoint";
import type { TextEdit } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

/** A host note whose workbench refuses the next `refusals` edits. */
function hostNote(initial: string, refusals = 0) {
  let text = initial;
  let refuse = refusals;
  const host = fakeHost({
    hostDocuments: {
      async apply(_document, edits: readonly TextEdit[]) {
        if (refuse > 0) {
          refuse--;
          return false;
        }
        for (const edit of [...edits].reverse()) {
          text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        }
        session.changed();
        return true;
      },
    },
  });
  const session = new Session(fakeDocument({ getText: () => text }), host);
  return {
    session,
    get text() {
      return text;
    },
  };
}

function panelView(doc: string, clientID = "panel"): EditorView {
  let state = EditorState.create({
    doc,
    extensions: collab({ clientID, startVersion: 0 }),
  });
  return {
    get state() {
      return state;
    },
    get composing() {
      return false;
    },
    dom: { addEventListener() {}, setAttribute() {} },
    dispatch(...trs: (Transaction | TransactionSpec)[]) {
      for (const tr of trs) {
        state = tr instanceof Transaction ? tr.state : state.update(tr).state;
      }
    },
  } as unknown as EditorView;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** A panel synchronizing with `note` that retries at once. */
function connect(
  note: ReturnType<typeof hostNote>,
  rpcFor: (client: Endpoint) => Endpoint = (client) => client,
) {
  const pair = rpcPair();
  const view = panelView(note.session.text);
  const statuses: string[] = [];
  const sync = new Synchronizer(
    view,
    rpcFor(pair.client),
    (message) => statuses.push(message),
    () => 0,
  );
  pair.client.on(protocol, "updates", (message) => sync.receive(message));
  note.session.attach("panel", pair.host);
  return { pair, view, sync, statuses };
}

test("an edit the workbench refuses once is sent again and reaches the note", async () => {
  const note = hostNote("base", 1);
  const panel = connect(note);

  panel.view.dispatch({ changes: { from: 4, insert: "!" } });
  panel.sync.pump();
  await settle();

  assert.equal(panel.sync.error, undefined);
  assert.equal(note.text, "base!");
  assert.equal(sendableUpdates(panel.view.state).length, 0);
  assert.equal(panel.statuses.at(-1), "");
  // Typing after the recovery goes through too.
  panel.view.dispatch({ changes: { from: 5, insert: "?" } });
  panel.sync.pump();
  await settle();
  assert.equal(note.text, "base!?");
  await panel.pair.dispose();
});

test("a push that times out on a busy host is retried, not the end of sync", async () => {
  const note = hostNote("base");
  let timeouts = 1;
  const panel = connect(
    note,
    (client) =>
      ({
        call: (...args: Parameters<Endpoint["call"]>) => {
          if (args[1] === "push" && timeouts > 0) {
            timeouts--;
            return Promise.reject(callFailed.timeout("push", 10_000));
          }
          return client.call(...args);
        },
      }) as unknown as Endpoint,
  );

  panel.view.dispatch({ changes: { from: 0, insert: "# " } });
  panel.sync.pump();
  await settle();

  assert.equal(panel.sync.error, undefined);
  assert.match(panel.statuses.join("\n"), /Not synced yet .*Retrying/);
  assert.equal(note.text, "# base");
  await panel.sync.flush();
  await panel.pair.dispose();
});

test("a diverged panel stops syncing and turns read-only", async () => {
  const note = hostNote("base");
  const panel = connect(
    note,
    () =>
      ({
        call: () =>
          Promise.reject(
            new Error("Edit does not match its document revision."),
          ),
      }) as unknown as Endpoint,
  );

  panel.view.dispatch({ changes: { from: 4, insert: "!" } });
  panel.sync.pump();
  await settle();

  assert.match(String(panel.sync.error), /does not match/);
  assert.equal(panel.view.state.readOnly, true);
  // The typing is still there to copy.
  assert.equal(panel.view.state.doc.toString(), "base!");
  await panel.pair.dispose();
});

test("a panel that cannot flush fails only its own commands, not another panel's", async () => {
  let text = "base";
  const host = fakeHost({
    hostDocuments: {
      async apply(_document, edits) {
        for (const edit of [...edits].reverse()) {
          text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        }
        return true;
      },
    },
  });
  const session = new Session(fakeDocument({ getText: () => text }), host);
  const panels = ["A", "B"].map((id) => {
    const pair = rpcPair();
    const connection = new ViewConnection(
      { version: 0, clientID: id },
      pair.client,
      () => {},
    );
    pair.client.handle(protocol, "flush", async () => {
      await connection.flush();
      return true;
    });
    session.attach(id, pair.host);
    return { pair, connection };
  });
  const [a, b] = panels as [(typeof panels)[0], (typeof panels)[0]];
  a.connection.attach(panelView("base", "A"));
  // B never mounted its editor, so its flush fails.

  await session.flush("A");
  await assert.rejects(session.flush("B"), /Editor not mounted/);
  await session.flush();
  await a.pair.dispose();
  await b.pair.dispose();
});
