import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as HostNavigation from "../../../src/host/navigation";
import { MARKDOWN_EDITOR } from "../../../src/shared/editor-provider";

function loadNavigation(vscode: unknown) {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  // Each test brings its own fake: load the host modules again for it.
  for (const id of Object.keys(require.cache)) {
    if (id.includes("/src/host/") || id.includes("/src/shared/")) {
      delete require.cache[id];
    }
  }
  try {
    return require("../../../src/host/navigation.ts") as typeof HostNavigation;
  } finally {
    loader._load = originalLoad;
  }
}

function parseUri(uri: string) {
  const url = new URL(uri);
  return {
    scheme: url.protocol.slice(0, -1),
    authority: url.host,
    path: decodeURIComponent(url.pathname),
    fsPath: fileURLToPath(url),
    toString: () => url.href,
  };
}

test("navigation superseded during document warming does not open the old note", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory).href;
  const stale = pathToFileURL(join(directory, "Old.md")).href;
  const current = pathToFileURL(join(directory, "New.markdown")).href;
  const warmed: string[] = [];
  const commands: unknown[][] = [];
  let finishWarm = () => {};
  let notifyWarming = () => {};
  const warmPending = new Promise<void>((resolve) => {
    finishWarm = resolve;
  });
  const warmingStarted = new Promise<void>((resolve) => {
    notifyWarming = resolve;
  });
  t.after(() => finishWarm());
  const { createNavigation } = loadNavigation({
    Uri: { parse: parseUri },
    env: { appName: "Cursor", uriScheme: "vscode" },
    window: { tabGroups: { activeTabGroup: { viewColumn: 1 } } },
    workspace: {
      getConfiguration: () => ({ get: () => "on" }),
      async openTextDocument(uri: ReturnType<typeof parseUri>) {
        warmed.push(uri.toString());
        if (uri.toString() === stale) {
          notifyWarming();
          await warmPending;
        }
      },
    },
    commands: {
      async executeCommand(
        command: string,
        uri: ReturnType<typeof parseUri>,
        ...args: unknown[]
      ) {
        commands.push([command, uri.toString(), ...args]);
      },
    },
  });
  const navigation = createNavigation(() => []);
  const oldIntent = navigation.begin!();
  const oldOpen = navigation.open(
    root,
    stale,
    "",
    "here",
    undefined,
    oldIntent,
  );
  await warmingStarted;
  assert.deepEqual(commands, []);

  await navigation.open(root, current, "", "here");
  assert.equal(oldIntent.token.cancelled, true);
  finishWarm();
  await oldOpen;
  assert.deepEqual(warmed, [stale, current]);
  assert.deepEqual(commands, [
    ["vscode.openWith", current, MARKDOWN_EDITOR.viewType, 1],
  ]);
});

test("a link to a PDF opens it in Lumia PDF at its page, beside when asked", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory).href;
  const pdf = pathToFileURL(join(directory, "paper.pdf")).href;
  const commands: unknown[][] = [];
  const withFragment = (uri: string) =>
    Object.assign(parseUri(uri), {
      with: ({ fragment }: { fragment: string }) =>
        withFragment(`${uri.split("#")[0]}${fragment ? `#${fragment}` : ""}`),
    });
  const { createNavigation, PDF_OPEN_LOCATION_COMMAND } = loadNavigation({
    Uri: { parse: withFragment },
    ViewColumn: { Beside: -2 },
    env: { appName: "Visual Studio Code", uriScheme: "vscode" },
    window: { tabGroups: { activeTabGroup: { viewColumn: 1 } } },
    workspace: { getConfiguration: () => ({ get: () => "on" }) },
    commands: {
      async executeCommand(
        command: string,
        uri: ReturnType<typeof parseUri>,
        ...args: unknown[]
      ) {
        commands.push([command, uri.toString(), ...args]);
      },
    },
  });
  const navigation = createNavigation(() => []);
  await navigation.open(root, pdf, "page=3", "here");
  await navigation.open(root, pdf, "page=5&viewrect=1,2,3,4", "side");
  // A highlight in the PDF's sidecar: Lumia PDF finds it.
  await navigation.open(root, pdf, "hl-a1b2c3d4", "here");
  // Not a PDF location (a heading, say): open the PDF where it was left.
  await navigation.open(root, pdf, "Introduction", "here");
  assert.deepEqual(commands, [
    [PDF_OPEN_LOCATION_COMMAND, `${pdf}#page=3`, undefined, { viewColumn: 1 }],
    [
      PDF_OPEN_LOCATION_COMMAND,
      `${pdf}#page=5&viewrect=1,2,3,4`,
      undefined,
      { viewColumn: -2 },
    ],
    [
      PDF_OPEN_LOCATION_COMMAND,
      `${pdf}#hl-a1b2c3d4`,
      undefined,
      { viewColumn: 1 },
    ],
    [PDF_OPEN_LOCATION_COMMAND, pdf, undefined, { viewColumn: 1 }],
  ]);
});

test("a Cmd-clicked link opens a tab VS Code keeps, not the preview the next link replaces", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory).href;
  const note = pathToFileURL(join(directory, "Note.md")).href;
  const file = pathToFileURL(join(directory, "data.csv")).href;
  const commands: unknown[][] = [];
  const withFragment = (uri: string) =>
    Object.assign(parseUri(uri), {
      with: ({ fragment }: { fragment: string }) =>
        withFragment(`${uri.split("#")[0]}${fragment ? `#${fragment}` : ""}`),
    });
  const { createNavigation } = loadNavigation({
    Uri: { parse: withFragment },
    ViewColumn: { Beside: -2 },
    env: { appName: "Visual Studio Code", uriScheme: "vscode" },
    window: { tabGroups: { activeTabGroup: { viewColumn: 1 } } },
    workspace: {
      getConfiguration: () => ({ get: () => "on" }),
      async openTextDocument() {},
    },
    commands: {
      async executeCommand(
        command: string,
        uri: ReturnType<typeof parseUri>,
        ...args: unknown[]
      ) {
        commands.push([command, uri.toString(), ...args]);
      },
    },
  });
  const navigation = createNavigation(() => []);
  await navigation.open(root, note, "", "here");
  await navigation.open(root, note, "", "tab");
  await navigation.open(root, file, "", "tab");
  assert.deepEqual(commands, [
    ["vscode.openWith", note, MARKDOWN_EDITOR.viewType, 1],
    [
      "vscode.openWith",
      note,
      MARKDOWN_EDITOR.viewType,
      { viewColumn: 1, preview: false },
    ],
    ["vscode.open", file, { viewColumn: 1, preview: false }],
  ]);
});

test("createNote: basename respects newNoteFolder; foldered path is vault-relative", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-create-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const nested = join(directory, "wiki", "resources", "notes");
  await mkdir(nested, { recursive: true });
  const sourcePath = join(nested, "Source.md");
  await writeFile(sourcePath, "source");
  const root = pathToFileURL(directory).href;
  const source = pathToFileURL(sourcePath).href;

  class FileSystemError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  class WorkspaceEdit {
    creates: ReturnType<typeof fileUri>[] = [];
    createFile(uri: ReturnType<typeof fileUri>) {
      this.creates.push(uri);
    }
  }
  function fileUri(fsPath: string) {
    const href = pathToFileURL(fsPath).href;
    const url = new URL(href);
    const uri = {
      scheme: url.protocol.slice(0, -1),
      authority: url.host,
      path: decodeURIComponent(url.pathname),
      fsPath,
      toString: () => href,
      with({ path: next }: { path: string }) {
        return fileUri(next);
      },
    };
    return uri;
  }
  function joinPath(base: ReturnType<typeof fileUri>, ...parts: string[]) {
    return fileUri(join(base.fsPath, ...parts));
  }

  const { createNavigation } = loadNavigation({
    Uri: {
      parse: (value: string) => fileUri(fileURLToPath(value)),
      joinPath,
    },
    WorkspaceEdit,
    FileSystemError,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    env: { appName: "Cursor", uriScheme: "vscode" },
    window: { tabGroups: { activeTabGroup: { viewColumn: 1 } } },
    workspace: {
      getConfiguration: () => ({ get: () => "on" }),
      fs: {
        async stat(uri: { fsPath: string }) {
          try {
            await access(uri.fsPath);
            return { type: 1 };
          } catch {
            throw new FileSystemError("missing", "FileNotFound");
          }
        },
      },
      async applyEdit(edit: WorkspaceEdit) {
        for (const uri of edit.creates) {
          await mkdir(join(uri.fsPath, ".."), { recursive: true });
          await writeFile(uri.fsPath, "");
        }
        return true;
      },
    },
    commands: { async executeCommand() {} },
  });

  const navigation = createNavigation(() => []);
  async function create(link: string, newNoteFolder: string) {
    return navigation.resolve({
      root,
      source,
      path: link,
      create: true,
      folderNote: "",
      newNoteFolder,
    });
  }

  assert.equal(
    await create("Beside", "."),
    pathToFileURL(join(nested, "Beside.md")).href,
  );
  assert.equal(
    await create("RootNote", ""),
    pathToFileURL(join(directory, "RootNote.md")).href,
  );
  assert.equal(
    await create("InboxNote", "Inbox"),
    pathToFileURL(join(directory, "Inbox", "InboxNote.md")).href,
  );

  const foldered = await create("wiki/projects/DServer/Decision", ".");
  assert.equal(
    foldered,
    pathToFileURL(join(directory, "wiki/projects/DServer/Decision.md")).href,
  );
  assert.equal(
    await readFile(
      join(directory, "wiki/projects/DServer/Decision.md"),
      "utf8",
    ),
    "",
  );
  await assert.rejects(
    () => readFile(join(nested, "wiki/projects/DServer/Decision.md"), "utf8"),
    /ENOENT/,
  );

  assert.equal(
    await create("wiki/other/Topic", "Inbox"),
    pathToFileURL(join(directory, "wiki/other/Topic.md")).href,
  );
  assert.equal(
    await create("/wiki/abs/Note", "."),
    pathToFileURL(join(directory, "wiki/abs/Note.md")).href,
  );
});
