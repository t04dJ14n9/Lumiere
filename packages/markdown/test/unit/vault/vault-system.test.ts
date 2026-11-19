import { fakeConfiguration } from "../../support/vscode-fake";
import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as HostVaultSystem from "../../../src/host/vault-system";

function loadVaultSystem(vscode: unknown) {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  for (const id of Object.keys(require.cache)) {
    if (id.includes("/src/host/") || id.includes("/src/shared/")) {
      delete require.cache[id];
    }
  }
  try {
    return require("../../../src/host/vault-system.ts") as typeof HostVaultSystem;
  } finally {
    loader._load = originalLoad;
  }
}

test("vault-system traverses directories concurrently in batches and skips ignored paths", async () => {
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  const rootUri = "file:///remote-ceph-workspace";
  const childFolders = Array.from({ length: 40 }, (_, index) => `dir-${index}`);
  const entered: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const parseUri = (raw: string) => {
    const url = new URL(raw);
    return {
      scheme: url.protocol.slice(0, -1),
      path: decodeURIComponent(url.pathname),
      toString: () => url.href,
    };
  };

  const { createVaultSystem, STAT_CONCURRENCY } = loadVaultSystem({
    FileType,
    RelativePattern: class {},
    Uri: {
      parse: parseUri,
      joinPath: (base: { toString(): string }, ...parts: string[]) =>
        parseUri(
          `${base.toString().replace(/\/+$/, "")}/${parts.map(encodeURIComponent).join("/")}`,
        ),
    },
    workspace: {
      workspaceFolders: [],
      getWorkspaceFolder: () => undefined,
      onDidChangeTextDocument: () => ({ dispose() {} }),
      onDidCloseTextDocument: () => ({ dispose() {} }),
      onDidRenameFiles: () => ({ dispose() {} }),
      createFileSystemWatcher: () => ({
        onDidCreate: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
      }),
      fs: {
        async readDirectory(uri: { path: string }) {
          entered.push(uri.path);
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 10));
          inFlight--;
          if (uri.path === "/remote-ceph-workspace") {
            return [
              [".obsidian", FileType.Directory],
              [".git", FileType.Directory],
              ["node_modules", FileType.Directory],
              ...childFolders.map(
                (name) => [name, FileType.Directory] as const,
              ),
            ];
          }
          return [["guide.md", FileType.File]];
        },
        async stat() {
          return { type: FileType.File, mtime: 100, size: 42 };
        },
      },
    },
    window: { showWarningMessage() {} },
  });

  const system = createVaultSystem(
    {
      extensionUri: parseUri("file:///ext") as never,
      storageUri: undefined,
    } as never,
    fakeConfiguration(),
  );

  const listing = await system.list(rootUri, 50_000);
  assert.equal(maxInFlight, STAT_CONCURRENCY);
  assert.equal(listing.files.length, childFolders.length);
  assert.equal(listing.partial, false);
  assert.ok(!entered.some((path) => path.includes("node_modules")));
  assert.ok(!entered.some((path) => path.includes(".git")));
  assert.ok(!entered.some((path) => path.includes(".obsidian")));
});

test("vault-system skips what files.exclude hides and limits notes apart from other files", async () => {
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  const parseUri = (raw: string) => {
    const url = new URL(raw);
    return {
      scheme: url.protocol.slice(0, -1),
      path: decodeURIComponent(url.pathname),
      toString: () => url.href,
    };
  };
  const folder = { uri: parseUri("file:///repo") };
  const entered: string[] = [];
  const tree: Record<string, [string, number][]> = {
    "/repo": [
      ["app.ts", FileType.File],
      ["debug.log", FileType.File],
      ...Array.from(
        { length: 30 },
        (_, n) => [`image-${n}.png`, FileType.File] as [string, number],
      ),
      ["out", FileType.Directory],
      ["notes", FileType.Directory],
    ],
    "/repo/out": [["Generated.md", FileType.File]],
    "/repo/notes": Array.from(
      { length: 5 },
      (_, n) => [`Note ${n}.md`, FileType.File] as [string, number],
    ),
  };
  const { createVaultSystem } = loadVaultSystem({
    FileType,
    RelativePattern: class {},
    Uri: {
      parse: parseUri,
      joinPath: (base: { toString(): string }, ...parts: string[]) =>
        parseUri(
          `${base.toString().replace(/\/+$/, "")}/${parts.map(encodeURIComponent).join("/")}`,
        ),
    },
    workspace: {
      workspaceFolders: [folder],
      getWorkspaceFolder: () => folder,
      getConfiguration: (section: string) => ({
        get: (key: string) =>
          section === "files" && key === "exclude"
            ? { out: true, "**/*.log": true, "**/*.ts": false }
            : undefined,
      }),
      fs: {
        async readDirectory(uri: { path: string }) {
          entered.push(uri.path);
          return tree[uri.path] ?? [];
        },
        async stat() {
          return { type: FileType.File, mtime: 1, size: 1 };
        },
      },
    },
  });
  const system = createVaultSystem(
    { storageUri: undefined } as never,
    fakeConfiguration(),
  );

  const listing = await system.list("file:///repo", 10);
  const paths = listing.files.map((file) => file.path);
  assert.ok(!entered.includes("/repo/out"), "an excluded folder is not walked");
  assert.ok(!paths.includes("debug.log"));
  assert.ok(paths.includes("app.ts"), "a pattern set to false is off");
  assert.equal(
    paths.filter((path) => path.endsWith(".md")).length,
    5,
    "every note, though other files filled the limit first",
  );
  assert.equal(paths.filter((path) => !path.endsWith(".md")).length, 10);
  assert.equal(listing.partial, true);
});

test("vault-system says file names ignore case where VS Code's workspace folders do", (t) => {
  const { createVaultSystem } = loadVaultSystem({});
  const system = createVaultSystem(
    { storageUri: undefined } as never,
    fakeConfiguration(),
  );
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  t.after(() => Object.defineProperty(process, "platform", platform));
  for (const [name, files] of [
    ["win32", true],
    ["darwin", true],
    ["linux", false],
  ] as const) {
    Object.defineProperty(process, "platform", { value: name });
    assert.equal(system.ignoresCase?.("file:///C:/Notes"), files, name);
    assert.equal(
      system.ignoresCase?.("vscode-remote://ssh/Notes"),
      false,
      `${name}: another file system decides for itself`,
    );
  }
});
