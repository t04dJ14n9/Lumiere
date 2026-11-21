import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as HostNavigation from "../../../src/host/navigation";
import { NoteResources } from "../../../src/plugins/resources/note-resources";
import type { VaultIndex } from "../../../src/plugins/vault/api";
import { MARKDOWN_EDITOR } from "../../../src/shared/editor-provider";
import { forgetModules } from "../../support/module-cache";

function loadNavigation(vscode: unknown) {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  // Each test brings its own fake: load the host modules again for it.
  forgetModules(require, "/src/host/", "/src/shared/");
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

test("a link to a PDF opens it in Lumiere PDF at its page, beside when asked", async (t) => {
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
  // Not a PDF location (a heading, say): open the PDF where it was left.
  await navigation.open(root, pdf, "Introduction", "here");
  // Lumiere PDF's Copy link: `paper.pdf#page=3#:~:text=…` (a Chrome text fragment).
  await navigation.open(
    root,
    pdf,
    "page=3#:~:text=Scaled%20dot%2Dproduct%20attention",
    "here",
  );
  // `page=` must be a whole number before the directive or the end.
  await navigation.open(root, pdf, "page=3x#:~:text=a", "here");
  await navigation.open(root, pdf, "#:~:text=a", "here");
  assert.deepEqual(commands, [
    [PDF_OPEN_LOCATION_COMMAND, `${pdf}#page=3`, undefined, { viewColumn: 1 }],
    [
      PDF_OPEN_LOCATION_COMMAND,
      `${pdf}#page=5&viewrect=1,2,3,4`,
      undefined,
      { viewColumn: -2 },
    ],
    [PDF_OPEN_LOCATION_COMMAND, pdf, undefined, { viewColumn: 1 }],
    [
      PDF_OPEN_LOCATION_COMMAND,
      `${pdf}#page=3#:~:text=Scaled%20dot%2Dproduct%20attention`,
      undefined,
      { viewColumn: 1 },
    ],
    [PDF_OPEN_LOCATION_COMMAND, pdf, undefined, { viewColumn: 1 }],
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

test("a link that must not take the focus opens its tab or split with preserveFocus", async (t) => {
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
  const keep = { preserveFocus: true };
  await navigation.open(root, note, "", "tab", undefined, undefined, keep);
  await navigation.open(root, note, "", "side", undefined, undefined, keep);
  await navigation.open(root, file, "", "tab", undefined, undefined, keep);
  assert.deepEqual(commands, [
    [
      "vscode.openWith",
      note,
      MARKDOWN_EDITOR.viewType,
      { viewColumn: 1, preview: false, preserveFocus: true },
    ],
    [
      "vscode.openWith",
      note,
      MARKDOWN_EDITOR.viewType,
      { viewColumn: -2, preserveFocus: true },
    ],
    [
      "vscode.open",
      file,
      { viewColumn: 1, preview: false, preserveFocus: true },
    ],
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
        // `next` is a URI path (/C:/... on Windows), not a file system path.
        const moved = new URL(href);
        moved.pathname = next;
        return fileUri(fileURLToPath(moved));
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

/** Shared vscode fake + vault layout for resolve (create:false) path tests. */
async function withResolveVault(
  t: { after: (fn: () => void | Promise<void>) => void },
  run: (ctx: {
    navigation: ReturnType<
      ReturnType<typeof loadNavigation>["createNavigation"]
    >;
    root: string;
    source: string;
    directory: string;
    areas: string;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-resolve-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const areas = join(directory, "wiki", "areas");
  const mocs = join(directory, "wiki", "resources", "mocs");
  await mkdir(areas, { recursive: true });
  await mkdir(mocs, { recursive: true });
  const sourcePath = join(areas, "Source.md");
  await writeFile(sourcePath, "source");
  await writeFile(join(mocs, "Target.md"), "target");
  await writeFile(join(areas, "Beside.md"), "beside");
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
        // `next` is a URI path (/C:/... on Windows), not a file system path.
        const moved = new URL(href);
        moved.pathname = next;
        return fileUri(fileURLToPath(moved));
      },
    };
    return uri;
  }
  function joinPath(base: ReturnType<typeof fileUri>, ...parts: string[]) {
    return fileUri(join(base.fsPath, ...parts));
  }

  class WorkspaceEdit {
    creates: ReturnType<typeof fileUri>[] = [];
    createFile(uri: ReturnType<typeof fileUri>) {
      this.creates.push(uri);
    }
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

  await run({
    navigation: createNavigation(() => []),
    root,
    source,
    directory,
    areas,
  });
}

test("resolve: foldered path (create:false) is vault-relative, not under source parent", async (t) => {
  await withResolveVault(t, async ({ navigation, root, source, directory }) => {
    const resolved = await navigation.resolve({
      root,
      source,
      path: "wiki/resources/mocs/Target.md",
      create: false,
      folderNote: "",
      newNoteFolder: "",
    });
    assert.equal(
      resolved,
      pathToFileURL(join(directory, "wiki/resources/mocs/Target.md")).href,
    );
    // Must not have looked under wiki/areas/wiki/resources/...
    assert.notEqual(
      resolved,
      pathToFileURL(join(directory, "wiki/areas/wiki/resources/mocs/Target.md"))
        .href,
    );
  });
});

test("resolve: basename (create:false) still uses source parent", async (t) => {
  await withResolveVault(t, async ({ navigation, root, source, areas }) => {
    const resolved = await navigation.resolve({
      root,
      source,
      path: "Beside.md",
      create: false,
      folderNote: "",
      newNoteFolder: "",
    });
    assert.equal(resolved, pathToFileURL(join(areas, "Beside.md")).href);
  });
});

/**
 * The preview and embed side of a link: resources over the same disk, with
 * an index that knows no file, as for the hidden files the index skips.
 */
function previewOver(root: string, source: string) {
  const fromUri = (uri: string) => fileURLToPath(uri);
  return new NoteResources({
    source,
    vault: {
      root,
      resolveLink() {
        return undefined;
      },
    } as unknown as VaultIndex,
    host: {
      workspace: {
        async stat(uri: string) {
          const found = await stat(fromUri(uri));
          return { mtime: found.mtimeMs, symbolicLink: false };
        },
      },
      hostDocuments: {
        async open(uri: string) {
          const text = await readFile(fromUri(uri), "utf8");
          return { getText: () => text };
        },
      },
    } as never,
    resourceUrl: (uri) => uri,
  });
}

test("resolve: a bare link names the file a preview names, whether or not a click may create", async (t) => {
  await withResolveVault(t, async ({ navigation, root, source, directory }) => {
    const areas = join(directory, "wiki", "areas");
    // Neither file is in any index: both are hidden, with different content.
    await writeFile(join(areas, ".twin.md"), "beside");
    await writeFile(join(directory, ".twin.md"), "root");
    await writeFile(join(directory, ".rootonly.md"), "root only");
    const preview = previewOver(root, source);
    const href = (...parts: string[]) =>
      pathToFileURL(join(directory, ...parts)).href;
    const click = (path: string, create: boolean, newNoteFolder = "") =>
      navigation.resolve({
        root,
        source,
        path,
        create,
        folderNote: "",
        newNoteFolder,
      });

    // A Markdown link to `.twin.md` may create a note when it names none, but
    // both files exist, so every way of asking finds the neighbour.
    for (const create of [true, false]) {
      assert.equal(
        await click(".twin.md", create),
        href("wiki/areas/.twin.md"),
        `click, create: ${create}`,
      );
    }
    const peeked = await preview.load(".twin.md");
    assert.equal(peeked.source, href("wiki/areas/.twin.md"));
    assert.equal(peeked.text, "beside");

    // Explicit forms keep their meaning in both.
    assert.equal(await click("./.twin.md", true), href("wiki/areas/.twin.md"));
    assert.equal((await preview.load("./.twin.md")).source, peeked.source);
    assert.equal(await click("/.twin.md", true), href(".twin.md"));
    assert.equal((await preview.load("/.twin.md")).text, "root");

    // With no neighbour the vault root's file is the one both name, and a
    // click does not make a second note in `newNoteFolder` beside it.
    assert.equal(
      await click(".rootonly.md", true, "Inbox"),
      href(".rootonly.md"),
    );
    assert.equal(
      (await preview.load(".rootonly.md")).source,
      href(".rootonly.md"),
    );
    await assert.rejects(
      () => stat(join(directory, "Inbox")),
      /ENOENT/,
      "no note was made",
    );
  });
});

test("resolve: a bare link that names no file is still made where it was; the note made is the one a preview names", async (t) => {
  await withResolveVault(t, async ({ navigation, root, source, directory }) => {
    const preview = previewOver(root, source);
    const click = (path: string, create: boolean, newNoteFolder: string) =>
      navigation.resolve({
        root,
        source,
        path,
        create,
        folderNote: "",
        newNoteFolder,
      });
    await assert.rejects(() => preview.load(".fresh.md"), /Resource not found/);
    assert.equal(await click(".fresh.md", false, ""), undefined);
    await assert.rejects(() => stat(join(directory, ".fresh.md")), /ENOENT/);

    assert.equal(
      await click(".fresh.md", true, ""),
      pathToFileURL(join(directory, ".fresh.md")).href,
    );
    assert.equal(
      await click(".inbox.md", true, "Inbox"),
      pathToFileURL(join(directory, "Inbox", ".inbox.md")).href,
    );
    assert.equal(
      await click(".beside.md", true, "."),
      pathToFileURL(join(directory, "wiki", "areas", ".beside.md")).href,
    );
    // The note that now exists is the one a preview names too.
    assert.equal(
      (await preview.load(".fresh.md")).source,
      pathToFileURL(join(directory, ".fresh.md")).href,
    );
  });
});

test("resolve: ./ and ../ start from the source note's folder, sub/ falls back to it", async (t) => {
  await withResolveVault(t, async ({ navigation, root, source, directory }) => {
    const areas = join(directory, "wiki", "areas");
    await mkdir(join(areas, "sub"), { recursive: true });
    await mkdir(join(directory, "sub"), { recursive: true });
    await writeFile(join(areas, "sub", "Only.md"), "only here");
    await writeFile(join(areas, "sub", "N.md"), "nested");
    await writeFile(join(directory, "sub", "N.md"), "root twin");
    const resolve = (path: string, create = false) =>
      navigation.resolve({
        root,
        source,
        path,
        create,
        folderNote: "",
        newNoteFolder: "",
      });
    const href = (...parts: string[]) =>
      pathToFileURL(join(directory, ...parts)).href;

    assert.equal(await resolve("./Beside.md"), href("wiki/areas/Beside.md"));
    assert.equal(
      await resolve("../resources/mocs/Target.md"),
      href("wiki/resources/mocs/Target.md"),
    );
    assert.equal(await resolve("./sub/N.md"), href("wiki/areas/sub/N.md"));
    assert.equal(
      await resolve("/wiki/resources/mocs/Target.md"),
      href("wiki/resources/mocs/Target.md"),
    );
    assert.equal(await resolve("./missing.md"), undefined);
    // sub/Only.md is not at the vault root: the source folder is the fallback.
    assert.equal(await resolve("sub/Only.md"), href("wiki/areas/sub/Only.md"));
    // The exact vault path wins over the source-relative one, as in Obsidian.
    assert.equal(await resolve("sub/N.md"), href("sub/N.md"));
    assert.equal(await resolve("sub/Nope.md"), undefined);

    // An explicit relative path is also where a new note is made.
    assert.equal(await resolve("./Fresh", true), href("wiki/areas/Fresh.md"));
    assert.equal(await readFile(join(areas, "Fresh.md"), "utf8"), "");
  });
});

test("resolve: a relative path that leaves the vault is still refused", async (t) => {
  await withResolveVault(t, async ({ navigation, root, source }) => {
    for (const path of [
      "../../../outside.md",
      "./../../../outside.md",
      "sub/../../outside.md",
    ]) {
      for (const create of [false, true]) {
        await assert.rejects(
          () =>
            navigation.resolve({
              root,
              source,
              path,
              create,
              folderNote: "",
              newNoteFolder: "",
            }),
          /escapes the vault/,
          `${path} (create: ${create})`,
        );
      }
    }
  });
});

test("contained and createNote refuse dangling symlinks that point outside the vault", async (t) => {
  const outside = await mkdtemp(join(tmpdir(), "mw-navigation-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await withResolveVault(t, async ({ navigation, root, source, directory }) => {
    const { contained } = loadNavigation({ Uri: { parse: parseUri } });
    const danglingFile = join(directory, "escape.md");
    const danglingDir = join(directory, "escape-dir");
    await symlink(join(outside, "pwned.md"), danglingFile);
    await symlink(join(outside, "missing-dir"), danglingDir);

    await assert.rejects(
      () =>
        contained(
          parseUri(root) as never,
          parseUri(pathToFileURL(danglingFile).href) as never,
        ),
      /symlink escapes the vault/,
    );
    await assert.rejects(
      () =>
        contained(
          parseUri(root) as never,
          parseUri(pathToFileURL(join(danglingDir, "pwned.md")).href) as never,
        ),
      /symlink escapes the vault/,
    );
    await contained(
      parseUri(root) as never,
      parseUri(
        pathToFileURL(join(directory, "new-folder/fresh.md")).href,
      ) as never,
    );

    await assert.rejects(
      () =>
        navigation.resolve({
          root,
          source,
          path: "/escape",
          create: true,
          folderNote: "",
          newNoteFolder: "",
        }),
      /symlink escapes the vault/,
    );
    await assert.rejects(
      () => readFile(join(outside, "pwned.md"), "utf8"),
      /ENOENT/,
    );
  });
});

test("a jump whose editor cannot be found, or that a newer one cancels, is logged", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory).href;
  const note = pathToFileURL(join(directory, "Note.md")).href;
  const logged: [string, string][] = [];
  const logger = {
    debug: (message: string) => logged.push(["debug", message]),
    warn: (message: string) => logged.push(["warn", message]),
    error: (message: string) => logged.push(["error", message]),
  };
  let onOpen = () => {};
  const { createNavigation } = loadNavigation({
    Uri: { parse: parseUri },
    env: { appName: "Visual Studio Code", uriScheme: "vscode" },
    window: { tabGroups: { activeTabGroup: { viewColumn: 1 } } },
    workspace: {
      getConfiguration: () => ({ get: () => "on" }),
      async openTextDocument() {},
    },
    commands: {
      async executeCommand() {
        onOpen();
      },
    },
  });
  const navigation = createNavigation(() => [], undefined, logger);

  // A native editor handed over to Lumiere, with no Lumiere panel for it.
  await navigation.revealOpened(note, 1, 12, navigation.begin());
  assert.deepEqual(logged, [
    ["warn", "No single editor of the opened note to reveal in"],
  ]);

  // Another jump starts while VS Code opens this one's note.
  logged.length = 0;
  onOpen = () => {
    navigation.begin();
  };
  await navigation.open(root, note, "", "here", 12, navigation.begin());
  assert.deepEqual(logged, [
    ["debug", "Reveal cancelled by a newer navigation"],
  ]);
});
