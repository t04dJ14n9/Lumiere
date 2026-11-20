import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "../../../src/host/bootstrap";
import type { NoteSettings, PanelShell } from "../../../src/shared/host";
import { Endpoint } from "../../../src/shared/rpc/endpoint";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { MemoryFileSystem, memorySystem, wait } from "../vault/memory-fs";
import { fakeViews } from "../views/fakes";
import { protocol } from "../../../src/plugins/editor/protocol";

function connectedShell(uri: string) {
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
    document: fakeDocument({ uri, getText: () => "# A" }),
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

// Each configure message makes the webview reconfigure every plugin.
test("a settings change that leaves the note's settings alone reconfigures no panel", async () => {
  let openPanel: (panel: PanelShell) => void = () => {};
  let note: NoteSettings = { preset: "obsidian", mode: "source" };
  const listeners = new Set<() => void>();
  const host = fakeHost({
    settings: {
      forNote: () => note,
      onChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
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
  const { shell, client } = connectedShell("memory:///vault/A.md");
  openPanel(shell);
  await client.call(protocol, "ready", {});
  await root.settled();
  const configured: unknown[] = [];
  client.on(protocol, "configureEditor", (value) => {
    configured.push(value);
  });
  const settingsChanged = async () => {
    for (const listener of [...listeners]) {
      listener();
    }
    await root.settled();
    await wait();
  };

  await settingsChanged();
  await settingsChanged();
  await settingsChanged();
  assert.ok(configured.length <= 1, `configured ${configured.length} times`);

  const before = configured.length;
  note = { ...note, debugLogging: true };
  await settingsChanged();
  await settingsChanged();
  assert.equal(configured.length, before + 1);
  await client.dispose();
  await root.dispose();
});
