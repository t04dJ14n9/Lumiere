import test from "node:test";
import assert from "node:assert/strict";
import { collab, getSyncedVersion, sendableUpdates } from "@codemirror/collab";
import {
  EditorState,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Session } from "../../../src/plugins/document/session";
import { Synchronizer } from "../../../src/plugins/document/sync";
import { protocol } from "../../../src/plugins/document/protocol";
import type { TextEdit } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { rpcPair } from "../../support/rpc-pair";

/** A host document whose text the test can rewrite as an external editor would. */
function hostSession(initial: string) {
  let text = initial;
  const host = fakeHost({
    hostDocuments: {
      async apply(_document, edits: readonly TextEdit[]) {
        for (const edit of [...edits].reverse()) {
          text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        }
        // Real workbenches report the change as the edit lands.
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
    external(next: string) {
      text = next;
      session.changed();
    },
  };
}

/** The view an editor panel would hold: Synchronizer needs state + dispatch. */
function panelView(doc: string, anchor = 0): EditorView {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: collab({ clientID: "panel", startVersion: 0 }),
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

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * A panel built from the text at version 0 whose host session is already at
 * version 1, so the host believes it sent update 0 that the panel never saw.
 */
function skewedPanel(initial: string, options: { anchor?: number } = {}) {
  const host = hostSession(initial);
  const view = panelView(initial, options.anchor);
  const pair = rpcPair();
  const sync = new Synchronizer(view, pair.client, () => {});
  let listening = true;
  pair.client.on(protocol, "updates", (message) => {
    if (listening) {
      sync.receive(message);
    }
  });
  return {
    host,
    view,
    sync,
    pair,
    attach: () => host.session.attach("panel", pair.host),
    stopListening: () => (listening = false),
    listen: () => (listening = true),
  };
}

function assertConverged(
  panel: ReturnType<typeof skewedPanel>,
  expected: string,
) {
  assert.equal(panel.sync.error, undefined);
  assert.equal(panel.view.state.doc.toString(), expected);
  assert.equal(panel.host.text, expected);
  assert.equal(panel.host.session.text, expected);
  // Never ahead of the host (nor behind it): the next push must be accepted.
  assert.equal(getSyncedVersion(panel.view.state), panel.host.session.version);
  assert.equal(sendableUpdates(panel.view.state).length, 0);
}

test("unsent typing survives a version skew and reaches the host", async () => {
  const panel = skewedPanel("base");
  panel.host.external("intro\nbase");
  panel.attach();
  panel.view.dispatch({ changes: { from: 2, insert: "!" } });

  panel.host.external("intro\nbase\nend");
  await settle();
  await panel.sync.flush();

  assertConverged(panel, "intro\nba!se\nend");
  await panel.pair.dispose();
});

test("more unsent updates than missed host updates never put the panel ahead", async () => {
  const panel = skewedPanel("base");
  panel.host.external("intro\nbase");
  panel.attach();
  for (const [at, character] of [
    [0, "x"],
    [2, "y"],
    [4, "z"],
  ] as const) {
    panel.view.dispatch({ changes: { from: at, insert: character } });
  }
  assert.equal(sendableUpdates(panel.view.state).length, 3);

  panel.host.external("intro\nbase\nend");
  await settle();
  await panel.sync.flush();

  assertConverged(panel, "intro\nxbyazse\nend");
  await panel.pair.dispose();
});

test("the caret stays on its text instead of jumping to the top", async () => {
  const panel = skewedPanel("base", { anchor: 2 });
  panel.host.external("intro\nbase");
  panel.attach();

  panel.host.external("intro\nbase\nend");
  await settle();

  assertConverged(panel, "intro\nbase\nend");
  assert.equal(panel.view.state.selection.main.head, 8);
  await panel.pair.dispose();
});

test("an edit the host already took is confirmed, not applied twice", async () => {
  const panel = skewedPanel("base");
  panel.attach();
  panel.view.dispatch({ changes: { from: 2, insert: "!" } });
  const pending = sendableUpdates(panel.view.state);

  // The push lands and is broadcast, but the panel is not listening yet.
  panel.stopListening();
  await panel.pair.client.call(protocol, "push", {
    version: 0,
    changes: pending.map((update) => update.changes.toJSON() as unknown[]),
  });
  await settle();
  assert.equal(panel.host.text, "ba!se");
  assert.equal(getSyncedVersion(panel.view.state), 0);

  panel.listen();
  panel.host.external("ba!se\nend");
  await settle();
  await panel.sync.flush();

  assertConverged(panel, "ba!se\nend");
  await panel.pair.dispose();
});

test("an unknown revision from the panel is refused, not guessed", async () => {
  const panel = skewedPanel("base");
  panel.attach();

  await assert.rejects(
    panel.pair.client.call(protocol, "catchUp", { version: 5 }),
    /Unknown document revision/,
  );
  await assert.rejects(
    panel.pair.client.call(protocol, "catchUp", { version: -1 }),
    /Invalid version|version/i,
  );
  await panel.pair.dispose();
});

test("answering a catch-up resumes broadcasts from the log's end", async () => {
  const panel = skewedPanel("base");
  panel.host.external("intro\nbase");
  panel.attach();
  panel.stopListening();
  panel.host.external("intro\nbase\nend");
  await settle();

  const log = await panel.pair.client.call(protocol, "catchUp", { version: 0 });
  assert.equal(log.version, 0);
  assert.equal(log.updates.length, 2);

  // The next broadcast starts where the answer ended, not at the old skew.
  const received: { version: number; updates: unknown[] }[] = [];
  panel.pair.client.on(protocol, "updates", (message) => {
    received.push(message);
  });
  panel.host.external("intro\nbase\nend!");
  await settle();

  assert.deepEqual(
    received.map((message) => message.version),
    [2],
  );
  await panel.pair.dispose();
});
