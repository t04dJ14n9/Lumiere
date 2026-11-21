import test from "node:test";
import assert from "node:assert/strict";
import {
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
import { NoteResources } from "../../../src/plugins/resources/note-resources";
import type { VaultIndex } from "../../../src/plugins/vault/api";
import { MARKDOWN_EDITOR } from "../../../src/shared/editor-provider";
import { diskNavigation, loadNavigation } from "../../support/disk-navigation";

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

test("a link to an HTML file goes to the HTML viewer with its vault, as text when asked; one outside the vault goes nowhere", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outsideDirectory = await mkdtemp(join(tmpdir(), "mw-navigation-out-"));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const root = pathToFileURL(directory).href;
  const page = pathToFileURL(join(directory, "diagram.html")).href;
  const old = pathToFileURL(join(directory, "old.htm")).href;
  const outside = pathToFileURL(join(outsideDirectory, "secret.html")).href;
  const commands: unknown[][] = [];
  const withFragment = (uri: string) =>
    Object.assign(parseUri(uri), {
      with: ({ fragment }: { fragment: string }) =>
        withFragment(`${uri.split("#")[0]}${fragment ? `#${fragment}` : ""}`),
    });
  const { createNavigation, HTML_VIEWER_COMMAND } = loadNavigation({
    Uri: { parse: withFragment },
    ViewColumn: { Beside: -2 },
    env: { appName: "Visual Studio Code", uriScheme: "vscode" },
    window: { tabGroups: { activeTabGroup: { viewColumn: 1 } } },
    workspace: {
      isTrusted: true,
      getConfiguration: () => ({ get: () => "on" }),
    },
    commands: {
      getCommands: async () => [
        "vscode.open",
        "lumiere.markdown.htmlViewer.open",
      ],
      async executeCommand(command: string, ...args: unknown[]) {
        commands.push([command, ...args]);
      },
    },
  });
  assert.equal(HTML_VIEWER_COMMAND, "lumiere.markdown.htmlViewer.open");
  const navigation = createNavigation(() => []);
  await navigation.open(root, page, "", "here");
  await navigation.open(root, old, "", "side");
  // A subpath (`#height=480`, `#gamma`) is the embed's, not a place to scroll a text editor to.
  await navigation.open(root, page, "height=480", "tab");
  assert.deepEqual(commands, [
    [HTML_VIEWER_COMMAND, page, root, { viewColumn: 1 }],
    [HTML_VIEWER_COMMAND, old, root, { viewColumn: -2 }],
    [HTML_VIEWER_COMMAND, page, root, { viewColumn: 1 }],
  ]);

  // Open as Text (an HTML embed's second button) skips the viewer, as for any file.
  commands.length = 0;
  await navigation.open(root, page, "", "here", undefined, undefined, {
    asText: true,
  });
  assert.deepEqual(
    commands.map(([command, uri]) => [command, String(uri)]),
    [["vscode.open", page]],
  );

  // The vault's own check stands before the viewer is asked.
  commands.length = 0;
  await assert.rejects(
    navigation.open(root, outside, "", "here"),
    /Link escapes the vault/,
  );
  assert.deepEqual(commands, []);
});

test("an HTML file opens as text when the viewer is not there, and other files never ask for it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory).href;
  const page = pathToFileURL(join(directory, "diagram.html")).href;
  const data = pathToFileURL(join(directory, "data.csv")).href;
  const commands: unknown[][] = [];
  let asked = 0;
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
      isTrusted: true,
      getConfiguration: () => ({ get: () => "on" }),
    },
    commands: {
      // The HTML Viewer plugin is turned off: its command is not registered.
      getCommands: async () => {
        asked += 1;
        return ["vscode.open"];
      },
      async executeCommand(command: string, ...args: unknown[]) {
        commands.push([command, ...args]);
      },
    },
  });
  const navigation = createNavigation(() => []);
  await navigation.open(root, page, "", "here");
  assert.equal(asked, 1);
  assert.deepEqual(
    commands.map(([command, uri]) => [command, String(uri)]),
    [["vscode.open", page]],
  );
  commands.length = 0;
  await navigation.open(root, data, "", "here");
  assert.equal(asked, 1, "a CSV never asks whether there is a viewer");
  assert.equal(commands[0]![0], "vscode.open");
});

test("in Restricted Mode an HTML link opens as text with the options main gave it, and never asks for the viewer", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-navigation-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outsideDirectory = await mkdtemp(join(tmpdir(), "mw-navigation-out-"));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const root = pathToFileURL(directory).href;
  const page = pathToFileURL(join(directory, "diagram.html")).href;
  const outside = pathToFileURL(join(outsideDirectory, "secret.html")).href;
  const commands: unknown[][] = [];
  let asked = 0;
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
      isTrusted: false,
      getConfiguration: () => ({ get: () => "on" }),
    },
    commands: {
      // The viewer is there, and is not asked: Restricted Mode is main's path.
      getCommands: async () => {
        asked += 1;
        return ["vscode.open", "lumiere.markdown.htmlViewer.open"];
      },
      async executeCommand(command: string, ...args: unknown[]) {
        commands.push([command, ...args]);
      },
    },
  });
  const navigation = createNavigation(() => []);
  const opened = () =>
    commands
      .splice(0)
      .map(([command, uri, ...rest]) => [command, String(uri), ...rest]);
  // Plain click: the current group, a bare column, as for any other file.
  await navigation.open(root, page, "", "here");
  assert.deepEqual(opened(), [["vscode.open", page, 1]]);
  // Mod-click: a tab VS Code keeps, not the preview the next link replaces.
  await navigation.open(root, page, "", "tab");
  assert.deepEqual(opened(), [
    ["vscode.open", page, { viewColumn: 1, preview: false }],
  ]);
  // Open Link to Side (Mod+Alt-click): the group beside.
  await navigation.open(root, page, "", "side");
  assert.deepEqual(opened(), [["vscode.open", page, -2]]);
  // `focusNewTab` off: opened without taking the focus.
  await navigation.open(root, page, "", "side", undefined, undefined, {
    preserveFocus: true,
  });
  assert.deepEqual(opened(), [
    ["vscode.open", page, { viewColumn: -2, preserveFocus: true }],
  ]);
  await navigation.open(root, page, "", "tab", undefined, undefined, {
    preserveFocus: true,
  });
  assert.deepEqual(opened(), [
    [
      "vscode.open",
      page,
      { viewColumn: 1, preview: false, preserveFocus: true },
    ],
  ]);
  // A fragment goes to the text editor as it did.
  await navigation.open(root, page, "L3", "here");
  assert.deepEqual(opened(), [["vscode.open", `${page}#L3`, 1]]);
  assert.equal(asked, 0, "the viewer was never asked for");
  // The same containment check first: nothing outside the vault opens.
  await assert.rejects(
    navigation.open(root, outside, "", "here"),
    /Link escapes the vault/,
  );
  assert.deepEqual(opened(), []);
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

  const navigation = diskNavigation();
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
    navigation: ReturnType<typeof diskNavigation>;
    root: string;
    source: string;
    directory: string;
    areas: string;
  }) => Promise<void>,
  /** Told the path of each file system `stat` the navigation makes. */
  onStat?: (fsPath: string) => void,
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

  await run({
    navigation: diskNavigation(onStat ? { onStat } : {}),
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

test("resolve: a bare link to another kind of file opens the one beside the note, else the vault root's", async (t) => {
  await withResolveVault(t, async ({ navigation, root, source, directory }) => {
    const areas = join(directory, "wiki", "areas");
    await writeFile(join(directory, "root-only.png"), "root");
    await writeFile(join(directory, "twin.png"), "root twin");
    await writeFile(join(areas, "twin.png"), "beside");
    const href = (...parts: string[]) =>
      pathToFileURL(join(directory, ...parts)).href;
    // `[x](image.png)` may not make a note, so only the lookup decides.
    const resolve = (path: string) =>
      navigation.resolve({
        root,
        source,
        path,
        create: false,
        folderNote: "",
        newNoteFolder: "",
      });

    // Only a vault-root file: the link opens it from a note in a folder.
    assert.equal(await resolve("root-only.png"), href("root-only.png"));
    // A file beside the note wins over the vault root's twin.
    assert.equal(await resolve("twin.png"), href("wiki/areas/twin.png"));
    // No file anywhere, and nothing is made for it.
    assert.equal(await resolve("nowhere.png"), undefined);
    await assert.rejects(() => stat(join(directory, "nowhere.png")), /ENOENT/);
    // `./` stays the note's folder only, with no vault-root fallback.
    assert.equal(await resolve("./root-only.png"), undefined);
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

test("resolve: a folder URI as the source is its own folder, as the Quick Switcher names the vault", async (t) => {
  await withResolveVault(t, async ({ navigation, root, directory }) => {
    // The Quick Switcher with no note open: the source is the vault root as
    // a folder (`file:///vault/`), whose parent is above the vault.
    const source = `${root}/`;
    await writeFile(join(directory, "Top.md"), "top");
    const href = (...parts: string[]) =>
      pathToFileURL(join(directory, ...parts)).href;
    const resolve = (path: string, create: boolean, newNoteFolder = "") =>
      navigation.resolve({
        root,
        source,
        path,
        create,
        folderNote: "",
        newNoteFolder,
      });

    for (const create of [false, true]) {
      assert.equal(await resolve("Top.md", create), href("Top.md"), "bare");
      assert.equal(
        await resolve("wiki/resources/mocs/Target.md", create),
        href("wiki/resources/mocs/Target.md"),
        "foldered",
      );
      assert.equal(await resolve("./Top.md", create), href("Top.md"));
    }
    // Names no file: nothing, and not an error from a place above the vault.
    assert.equal(await resolve("Nope.md", false), undefined);
    assert.equal(await resolve("wiki/Nope.md", false), undefined);
    assert.equal(await resolve("./Nope.md", false), undefined);

    // A note typed into the switcher is made in the vault, as a name or a path.
    assert.equal(await resolve("NewNote", true), href("NewNote.md"));
    assert.equal(await resolve("area/NewNote", true), href("area/NewNote.md"));
    assert.equal(await resolve("./Rel", true), href("Rel.md"));
    assert.equal(
      await readFile(join(directory, "area/NewNote.md"), "utf8"),
      "",
    );
    assert.equal(
      await resolve("InInbox", true, "Inbox"),
      href("Inbox/InInbox.md"),
    );
    // The current folder, with no note open, is the vault.
    assert.equal(await resolve("InFolder", true, "."), href("InFolder.md"));

    // The vault is still the limit.
    await assert.rejects(
      () => resolve("../outside.md", false),
      /escapes the vault/,
    );
    await assert.rejects(
      () => resolve("../outside", true),
      /escapes the vault/,
    );
  });
});

test("resolve: a place two folders share is asked about once", async (t) => {
  const asked: string[] = [];
  await withResolveVault(
    t,
    async ({ navigation, root, directory }) => {
      // A note at the vault root has the vault as its folder.
      const source = pathToFileURL(join(directory, "Top.md")).href;
      await writeFile(join(directory, "Top.md"), "top");
      for (const path of ["Nope.md", "area/Nope.md"]) {
        asked.length = 0;
        assert.equal(
          await navigation.resolve({
            root,
            source,
            path,
            create: false,
            folderNote: "",
            newNoteFolder: "",
          }),
          undefined,
        );
        assert.deepEqual(asked, [join(directory, path)], path);
      }
    },
    (fsPath) => asked.push(fsPath),
  );
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
