import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as WorkspaceFilesModule from "../../../src/host/workspace-files";

class Uri {
  constructor(readonly value: string) {}
  static parse(value: string) {
    return new Uri(value);
  }
  toString() {
    return this.value;
  }
}

interface CreateFileEdit {
  uri: string;
  options: { overwrite?: boolean; contents?: Uint8Array };
}

class WorkspaceEdit {
  readonly creates: CreateFileEdit[] = [];
  createFile(uri: Uri, options: CreateFileEdit["options"]) {
    this.creates.push({ uri: uri.toString(), options });
  }
}

/** What the real workspace does with an edit and with a stat. */
const state = {
  edits: [] as WorkspaceEdit[],
  isApplied: true,
  exists: false,
};

const vscode = {
  Uri,
  WorkspaceEdit,
  workspace: {
    async applyEdit(edit: WorkspaceEdit) {
      state.edits.push(edit);
      return state.isApplied;
    },
    fs: {
      async stat() {
        if (!state.exists) {
          throw new Error("FileNotFound");
        }
        return {};
      },
    },
  },
};

function loadFiles(): typeof WorkspaceFilesModule {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  try {
    return createRequire(import.meta.url)(
      "../../../src/host/workspace-files.ts",
    ) as typeof WorkspaceFilesModule;
  } finally {
    loader._load = originalLoad;
  }
}

const files = loadFiles().createWorkspaceFiles();
const NOTE = "file:///vault/Journal/2026-11-05.md";

test("createText asks VS Code to create the file without overwriting", async () => {
  Object.assign(state, { edits: [], isApplied: true, exists: false });
  assert.equal(await files.createText(NOTE, "# Today"), true);
  const [edit] = state.edits;
  assert.deepEqual(
    edit?.creates.map((item) => item.uri),
    [NOTE],
  );
  assert.equal(edit?.creates[0]?.options.overwrite, false);
  assert.equal(
    new TextDecoder().decode(edit?.creates[0]?.options.contents),
    "# Today",
  );
});

test("createText reports a file that was already there", async () => {
  Object.assign(state, { edits: [], isApplied: false, exists: true });
  assert.equal(await files.createText(NOTE, "# Today"), false);
});

test("createText fails when VS Code refuses and there is no file to blame", async () => {
  Object.assign(state, { edits: [], isApplied: false, exists: false });
  await assert.rejects(files.createText(NOTE, "# Today"), /Could not create/);
});
