import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import { contributionId } from "../../../src/shared/setting-schema";
import { dailyNotesHost } from "../../../src/plugins/dailyNotes/host";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import type { Vault, Vaults } from "../../../src/plugins/vault/api";
import { fakeConfiguration, fakeHost } from "../../support/vscode-fake";

const ROOT = "file:///vault";

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function start(options: {
  settings: Record<string, string>;
  files?: Record<string, string>;
  active?: string;
}) {
  const data = new Map(Object.entries(options.files ?? {}));
  const commands = new Map<string, () => unknown>();
  const opened: string[] = [];
  const messages: string[] = [];
  const prepared: string[] = [];
  const index = new MemoryVaultIndex({
    root: ROOT,
    folderNote: "",
    linkFormat: "shortest",
  });
  index.addFiles(
    [...data.keys()].map((uri) => ({
      uri,
      path: uri.slice(ROOT.length + 1),
      mtime: 0,
      size: 0,
    })),
  );
  const vault: Vault = {
    index,
    settled: async () => {},
    pathOf: (uri) =>
      uri.startsWith(`${ROOT}/`) ? uri.slice(ROOT.length + 1) : undefined,
  };
  const vaults = {
    locate: async (uri: string) => {
      const path = vault.pathOf(uri);
      return path === undefined ? undefined : { vault, path };
    },
    forWorkspace: async () => vault,
    open: async (uri: string) => {
      opened.push(uri);
    },
  } as unknown as Vaults;
  const host = fakeHost({
    hostCommands: {
      register: (id, run) => {
        commands.set(id, run as () => unknown);
        return () => {
          commands.delete(id);
        };
      },
    },
    dialogs: {
      inform: (message) => messages.push(message),
      error: (message) => messages.push(`error: ${message}`),
    },
    activeEditor: { note: () => options.active },
    settings: {
      effective: {
        ...fakeConfiguration(),
        get: <T>(key: string, fallback: T) =>
          (options.settings[key] as T | undefined) ?? fallback,
        prepare: async (resource) => {
          prepared.push(resource);
        },
      },
    },
    workspace: {
      files: {
        list: async (uri: string) => {
          const names = [...data.keys()]
            .filter((key) => key.startsWith(`${uri}/`))
            .map((key) => key.slice(uri.length + 1));
          return names.length ? names : undefined;
        },
        mkdir: async () => {},
        readText: async (uri: string) => data.get(uri),
        writeText: async (uri: string, text: string) => {
          data.set(uri, text);
        },
        isSymbolicLink: async () => false,
        authorize: async () => {},
      } as never,
    },
  });
  const root = createRoot();
  provideHostServices(root, host);
  root.provide("vaults", vaults);
  root.plugin(dailyNotesHost);
  await root.settled();
  // Reported commands do not return their work, so let it finish.
  const run = async (id: string) => {
    commands.get(contributionId(id))!();
    for (let tick = 0; tick < 20; tick += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  return { root, run, data, opened, messages, prepared };
}

test("Open Today's Daily Note creates today's note from the template once", async (t) => {
  const f = await start({
    settings: {
      "dailyNotes.folder": "Journal",
      "dailyNotes.template": "Templates/Daily",
    },
    files: { [`${ROOT}/Templates/Daily.md`]: "# {{title}}\n{{date:YYYY}}\n" },
    active: `${ROOT}/Notes/A.md`,
  });
  t.after(() => f.root.dispose());
  await f.run("dailyNotes.openToday");
  const uri = `${ROOT}/Journal/${today()}.md`;
  assert.deepEqual(f.opened, [uri]);
  assert.equal(f.data.get(uri), `# ${today()}\n${today().slice(0, 4)}\n`);
  // Settings are read for the active note, so its vault's Obsidian files apply.
  assert.deepEqual(f.prepared, [`${ROOT}/Notes/A.md`]);
  f.data.set(uri, "edited");
  await f.run("dailyNotes.openToday");
  assert.equal(f.data.get(uri), "edited");
  assert.deepEqual(f.messages, []);
});

test("previous and next start from the open daily note", async (t) => {
  const f = await start({
    settings: { "dailyNotes.folder": "Journal" },
    files: {
      [`${ROOT}/Journal/2020-01-01.md`]: "",
      [`${ROOT}/Journal/2020-01-03.md`]: "",
      [`${ROOT}/Journal/2020-01-09.md`]: "",
    },
    active: `${ROOT}/Journal/2020-01-03.md`,
  });
  t.after(() => f.root.dispose());
  await f.run("dailyNotes.openPrevious");
  await f.run("dailyNotes.openNext");
  assert.deepEqual(f.opened, [
    `${ROOT}/Journal/2020-01-01.md`,
    `${ROOT}/Journal/2020-01-09.md`,
  ]);
});

test("without an open daily note, previous starts from today", async (t) => {
  const f = await start({
    settings: { "dailyNotes.folder": "Journal" },
    files: { [`${ROOT}/Journal/2020-01-01.md`]: "" },
  });
  t.after(() => f.root.dispose());
  await f.run("dailyNotes.openPrevious");
  await f.run("dailyNotes.openNext");
  assert.deepEqual(f.opened, [`${ROOT}/Journal/2020-01-01.md`]);
  assert.deepEqual(f.messages, ["No later daily note."]);
  assert.deepEqual(f.prepared, [`${ROOT}/`, `${ROOT}/`]);
});
