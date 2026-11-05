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

/** Minimal view: Synchronizer only needs state + dispatch (+ composing for pump). */
function viewWith(
  doc: string,
  collabConfig: { clientID: string; startVersion?: number } = {
    clientID: "panel",
  },
): EditorView {
  let state = EditorState.create({
    doc,
    extensions: collab(collabConfig),
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

function stubRpc(): Endpoint {
  return {
    call: async () => true,
    notify: () => {},
  } as unknown as Endpoint;
}

test("host update with skewed version replaces instead of failing", () => {
  const view = viewWith("base", { clientID: "panel", startVersion: 0 });
  assert.equal(getSyncedVersion(view.state), 0);
  const statuses: string[] = [];
  const sync = new Synchronizer(view, stubRpc(), (message) => {
    statuses.push(message);
  });

  sync.receive({
    version: 1,
    updates: [
      {
        clientID: "host",
        changes: difference("base", "ext").toJSON(),
      },
    ],
  });

  assert.equal(sync.error, undefined);
  assert.equal(view.state.doc.toString(), "ext");
  assert.equal(getSyncedVersion(view.state), 2);
  assert.equal(sendableUpdates(view.state).length, 0);
  assert.ok(
    !statuses.some((s) => s.includes("copy your edits before reopening")),
  );
});

test("skewed version with a non-host update still fails", () => {
  const view = viewWith("base", { clientID: "panel", startVersion: 0 });
  const sync = new Synchronizer(view, stubRpc(), () => {});

  sync.receive({
    version: 1,
    updates: [
      {
        clientID: "panel",
        changes: difference("base", "ext").toJSON(),
      },
    ],
  });

  assert.match(String(sync.error), /copy your edits before reopening/);
  assert.equal(view.state.doc.toString(), "base");
});

test("skewed version with empty updates still fails", () => {
  const view = viewWith("base", { clientID: "panel", startVersion: 0 });
  const sync = new Synchronizer(view, stubRpc(), () => {});

  sync.receive({ version: 1, updates: [] });

  assert.match(String(sync.error), /copy your edits before reopening/);
});
