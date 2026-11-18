import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as SettingsAccessModule from "../../../src/host/settings-access";

const FOLDER = "file:///vault";
const KEY = "linkUpdates.mode";

/** Just enough of `vscode` for the settings access: the workspace folders and recorded writes. */
class Uri {
  static parse(value: string) {
    return new Uri(value);
  }
  constructor(private readonly value: string) {}
  toString() {
    return this.value;
  }
}
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const state = {
  folders: [FOLDER],
  inspected: {} as Record<string, unknown>,
  writes: [] as { target: number; scope: string | undefined; value: unknown }[],
};
const vscode = {
  Uri,
  ConfigurationTarget,
  commands: { executeCommand: async () => undefined },
  workspace: {
    get workspaceFolders() {
      return state.folders.length
        ? state.folders.map((folder) => ({ uri: new Uri(folder) }))
        : undefined;
    },
    getWorkspaceFolder: (uri: Uri) =>
      state.folders
        .map((folder) => ({ uri: new Uri(folder) }))
        .find((folder) => uri.toString().startsWith(`${folder.uri}/`)),
    getConfiguration: (_section: string, scope?: Uri) => ({
      // A fresh profile sets the key in no layer.
      inspect: () => state.inspected,
      get: () => undefined,
      update: async (_key: string, value: unknown, target: number) => {
        state.writes.push({ target, scope: scope?.toString(), value });
      },
    }),
  },
};

function loadSettingsAccess() {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  try {
    return require("../../../src/host/settings-access.ts") as typeof SettingsAccessModule;
  } finally {
    loader._load = originalLoad;
  }
}

const { createSettingsAccess } = loadSettingsAccess();

const access = createSettingsAccess({
  id: "test.lumiere",
  packageJSON: {
    contributes: {
      configuration: {
        properties: {
          "lumiere.markdown.linkUpdates.mode": {
            enum: ["prompt", "always", "never"],
            default: "prompt",
          },
        },
      },
    },
  },
});

test.beforeEach(() => {
  state.folders = [FOLDER];
  state.inspected = {};
  state.writes = [];
});

test("a per-folder write for a file in a workspace folder goes to that folder", async () => {
  const resource = `${FOLDER}/Topic/Old.md`;
  assert.equal(
    await access.update(KEY, "always", resource, "workspaceFolder"),
    "workspaceFolder",
  );
  assert.deepEqual(state.writes, [
    {
      target: ConfigurationTarget.WorkspaceFolder,
      scope: resource,
      value: "always",
    },
  ]);
});

test("a file outside every folder of an open workspace falls back to the workspace", async () => {
  assert.equal(
    await access.update(
      KEY,
      "always",
      "file:///elsewhere/Old.md",
      "workspaceFolder",
    ),
    "workspace",
  );
  assert.equal(state.writes[0]?.target, ConfigurationTarget.Workspace);
});

test("with no workspace a per-folder write goes to the user's settings", async () => {
  state.folders = [];
  assert.equal(
    await access.update(KEY, "always", undefined, "workspaceFolder"),
    "user",
  );
  assert.equal(state.writes[0]?.target, ConfigurationTarget.Global);
});

test("without a scope the write still goes where the setting is already set", async () => {
  // Nothing sets the key, so the Settings UI's rule picks the user's settings
  // even for a file in a folder: only a caller that asks writes the folder.
  assert.equal(await access.update(KEY, "always", `${FOLDER}/Old.md`), "user");
  assert.equal(state.writes[0]?.target, ConfigurationTarget.Global);
});

test("a per-folder write is still gated by the setting's schema", async () => {
  await assert.rejects(
    access.update(KEY, "sometimes", `${FOLDER}/Old.md`, "workspaceFolder"),
    /Not writing/,
  );
  assert.deepEqual(state.writes, []);
});

test("a per-folder write keeps a workspace value where the workspace sets it", async () => {
  // Only a key the user's settings would hold is moved to the folder: one the
  // workspace already sets is changed there, as the Settings UI would.
  state.inspected = { workspaceValue: "prompt" };
  assert.equal(
    await access.update(KEY, "always", `${FOLDER}/Old.md`, "workspaceFolder"),
    "workspace",
  );
  assert.equal(state.writes[0]?.target, ConfigurationTarget.Workspace);
});
