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

test("vault-system stats the notes before the listing and the other files after it", async () => {
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  const parseUri = (raw: string) => {
    const url = new URL(raw);
    return {
      scheme: url.protocol.slice(0, -1),
      path: decodeURIComponent(url.pathname),
      toString: () => url.href,
    };
  };
  const statted: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
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
      workspaceFolders: [],
      getWorkspaceFolder: () => undefined,
      fs: {
        async readDirectory() {
          return [
            ["Note.md", FileType.File],
            ["Other.markdown", FileType.File],
            ...Array.from(
              { length: 200 },
              (_, n) => [`src-${n}.ts`, FileType.File] as [string, number],
            ),
            ["image.png", FileType.File],
          ];
        },
        async stat(uri: { path: string }) {
          // A slow file system: other files' stats wait for the test.
          if (!/\.(md|markdown)$/.test(uri.path)) {
            await gate;
          }
          statted.push(uri.path);
          return { type: FileType.File, mtime: 7, size: uri.path.length };
        },
      },
    },
  });
  const system = createVaultSystem(
    { storageUri: undefined } as never,
    fakeConfiguration(),
  );

  const listing = await system.list("file:///repo", 50_000);
  // Only the notes were statted before the listing came back.
  assert.deepEqual(statted.sort(), ["/repo/Note.md", "/repo/Other.markdown"]);
  assert.equal(listing.files.length, 203);
  const image = listing.files.find((file) => file.path === "image.png")!;
  assert.equal(image.statPending, true);
  const note = listing.files.find((file) => file.path === "Note.md")!;
  assert.deepEqual(
    [note.mtime, note.size, note.statPending],
    [7, 13, undefined],
  );
  // The other files' stats follow.
  release();
  const stats = await listing.stats!;
  assert.equal(stats.length, 201);
  assert.deepEqual(
    stats.find((file) => file.path === "image.png"),
    { uri: "file:///repo/image.png", path: "image.png", mtime: 7, size: 15 },
  );
  assert.equal(statted.length, 203);
});

test("vault-system reports the unsaved text of .markdown and .MD notes, not of other documents", () => {
  let changed = (_event: unknown) => {};
  let closed = (_document: unknown) => {};
  const { createVaultSystem } = loadVaultSystem({
    workspace: {
      onDidChangeTextDocument: (listener: typeof changed) => {
        changed = listener;
        return { dispose() {} };
      },
      onDidCloseTextDocument: (listener: typeof closed) => {
        closed = listener;
        return { dispose() {} };
      },
    },
  });
  const system = createVaultSystem(
    { storageUri: undefined } as never,
    fakeConfiguration(),
  );
  const edited: string[] = [];
  const left: string[] = [];
  system.onDocumentChanged((uri) => edited.push(uri));
  system.onDocumentClosed((uri) => left.push(uri));
  const document = (path: string) => ({
    uri: { path, toString: () => `file://${path}` },
    getText: () => "text",
  });
  for (const path of ["/v/A.md", "/v/B.markdown", "/v/C.MD", "/v/D.txt"]) {
    changed({ document: document(path), contentChanges: [{}] });
    closed(document(path));
  }
  const notes = ["file:///v/A.md", "file:///v/B.markdown", "file:///v/C.MD"];
  assert.deepEqual(edited, notes);
  assert.deepEqual(left, notes);
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
