import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "../../../src/host/bootstrap";
import type { PanelShell } from "../../../src/shared/host";
import { Endpoint } from "../../../src/shared/rpc/endpoint";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { MemoryFileSystem, memorySystem } from "../vault/memory-fs";
import { fakeViews } from "../views/fakes";
import type { ListedFile } from "../../../src/plugins/vault/api";
import { protocol } from "../../../src/plugins/editor/protocol";
import { INITIAL_READY_BUDGET_MS } from "../../../src/plugins/vault/indexer";

const ROOT = "memory:///vault";
const NOTE_URI = `${ROOT}/notes/guide.md`;
const NOTE_TEXT = "# Guide\n\nSee [[notes/other]]";

function connectedShell(uri: string, text: string) {
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
    id: "panel-ceph",
    column: undefined,
    document: fakeDocument({ uri, getText: () => text }),
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

test("opening a note on a slow 15,000 ms network mount resolves panel ready before the vault's ready budget, with the note text", async () => {
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
  host.storage = {
    get: (_key, fallback) => fallback,
    update: async () => {},
  };

  const fs = new MemoryFileSystem({
    "notes/guide.md": NOTE_TEXT,
    "notes/other.md": "# Other",
  });
  const sys = memorySystem(fs);
  const finishers: (() => void)[] = [];
  const slowList = (root: string, limit: number, shallow?: boolean) =>
    new Promise<{ files: ListedFile[]; partial: boolean }>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve(sys.value.list(root, limit, shallow));
      };
      const timer = setTimeout(finish, 15_000);
      timer.unref?.();
      finishers.push(finish);
    });

  const root = await bootstrap(host, { ...sys.value, list: slowList });
  const { shell, client } = connectedShell(NOTE_URI, NOTE_TEXT);
  openPanel(shell);

  const startedAt = performance.now();
  const init = await client.call(protocol, "ready", {});
  const elapsedMs = performance.now() - startedAt;

  // Waiting on the vault would take the whole ready budget; well under it,
  // the panel did not wait, even on a busy machine (the full parallel run).
  const bound = INITIAL_READY_BUDGET_MS * 0.6;
  assert.ok(
    elapsedMs < bound,
    `expected panel ready in < ${bound} ms (no vault ready-budget wait), took ${Math.round(elapsedMs)} ms`,
  );
  assert.equal(init.text, NOTE_TEXT);
  assert.equal(init.source, NOTE_URI);

  const vaults = root.service("vaults");
  assert.ok(vaults, "vaults service is registered");
  const vault = await vaults.forDocument(NOTE_URI);
  assert.equal(vault.index.file("notes/guide.md")?.path, "notes/guide.md");

  while (finishers.length > 0) {
    finishers.shift()?.();
  }
  await vault.settled();
  assert.deepEqual(
    vault.index.files().map((file) => file.path),
    ["notes/guide.md", "notes/other.md"],
  );
  assert.equal(
    vault.index.resolveLink("notes/other", "notes/guide.md")?.path,
    "notes/other.md",
  );

  await client.dispose();
  await root.dispose();
});
