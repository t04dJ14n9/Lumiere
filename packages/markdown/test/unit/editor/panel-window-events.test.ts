import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "../../../src/host/bootstrap";
import type { PanelShell } from "../../../src/shared/host";
import { Endpoint } from "../../../src/shared/rpc/endpoint";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { MemoryFileSystem, memorySystem, wait } from "../vault/memory-fs";
import { fakeViews } from "../views/fakes";
import { protocol as editorProtocol } from "../../../src/plugins/editor/protocol";
import { protocol as gutterProtocol } from "../../../src/plugins/gitGutter/protocol";
import type { FullDiffRequest } from "../../../src/plugins/gitGutter/api";

const NOTE_URI = "memory:///vault/A.md";

function connectedShell() {
  let hostReceive = (_value: unknown) => {};
  let clientReceive = (_value: unknown) => {};
  const client = new Endpoint(
    {
      send: (value) => hostReceive(value),
      listen: (receive) => {
        clientReceive = receive;
        return () => {};
      },
    },
    {
      after(ms, callback) {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      },
    },
  );
  const shell: PanelShell = {
    id: "panel",
    column: undefined,
    document: fakeDocument({ uri: NOTE_URI, getText: () => "# A" }),
    cspSource: "test",
    trusted: true,
    transport: {
      send: (value) => clientReceive(value),
      listen: (receive) => {
        hostReceive = receive;
        return () => {};
      },
    },
    active: () => true,
    reveal() {},
    dispose() {},
    setHTML() {},
    asset: (path) => path,
    resource: (target) => target,
    onDispose: () => () => {},
    onState: () => () => {},
  };
  return { shell, client };
}

// The change bar's Open Full Diff runs in the panel's own plugin tree, while
// the rendered diff editor listens on the window's. Each tree has its own
// event bus, so the request reaches the diff editor only if the panel
// forwards it.
test("Open Full Diff in a panel reaches the window's diff editor", async () => {
  let openPanel: (panel: PanelShell) => void = () => {};
  const host = fakeHost({
    settings: { forNote: () => ({ preset: "obsidian", mode: "source" }) },
    customEditors: {
      register: (_provider, callback) => {
        openPanel = callback;
        return () => {};
      },
    },
  });
  host.views = fakeViews().views;
  host.storage = { get: (_key, fallback) => fallback, update: async () => {} };
  const fs = new MemoryFileSystem({ "A.md": "# A" });
  const root = await bootstrap(host, memorySystem(fs).value);
  const requests: FullDiffRequest[] = [];
  root.on("git-diff:open-full", (request) => {
    requests.push(request);
  });
  const { shell, client } = connectedShell();
  openPanel(shell);
  await client.call(editorProtocol, "ready", {});
  await root.settled();
  await wait();

  const answered = await client.call(gutterProtocol, "openFullDiff", {
    baseKind: "HEAD",
    targetKind: "WORKTREE",
  });

  assert.equal(answered, true);
  assert.deepEqual(requests, [
    {
      fileUri: NOTE_URI,
      base: { kind: "HEAD", oid: "HEAD" },
      target: { kind: "WORKTREE" },
    },
  ]);
  await client.dispose();
  await root.dispose();
});
