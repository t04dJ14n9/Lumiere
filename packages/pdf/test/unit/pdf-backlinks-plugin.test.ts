/**
 * Plugin pdfBacklinks, run as written against a fake VS Code: which notes'
 * links reach which open viewer.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import * as annotationStore from "../../src/shared/annotation-store";
import path from "node:path";
import { test } from "node:test";
import * as backlinkNoteUri from "../../src/shared/backlink-note-uri";
import * as markdownScan from "../../src/shared/markdown-scan";
import * as backlinkIndex from "../../src/shared/pdf-backlink-index";
import { loadModule } from "./support/load-module";

class Uri {
  constructor(readonly path: string) {}
  static parse(value: string): Uri {
    return new Uri(new URL(value).pathname);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(path.posix.join(base.path, ...parts));
  }
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    return `file://${this.path}`;
  }
}

class RelativePattern {
  constructor(
    readonly base: { uri: Uri },
    readonly pattern: string,
  ) {}
}

interface FakeNote {
  path: string;
  text: string;
}

interface FakePanel {
  uri: Uri;
  backlinks: { set(hits: unknown[]): void };
  /** Every `hits` the viewer was given, oldest first. */
  received: backlinkIndex.PdfBacklinkHit[][];
}

/** The workspace folders `/A` and `/B`, with `papers/a.pdf` in both. */
function launch(options: {
  folders?: string[];
  notes: FakeNote[];
  files: string[];
  viewers: string[];
  /** One entry per `stat`, in order: it waits for the entry before answering. */
  statGates?: Promise<void>[];
  /** The `files.exclude` setting of each workspace folder, by its path. */
  filesExclude?: Record<string, unknown>;
}) {
  const folders = (options.folders ?? ["/A", "/B"]).map((folder) => ({
    uri: new Uri(folder),
    name: folder.slice(1),
  }));
  const folderOf = (uri: Uri) =>
    folders.find((folder) => uri.path.startsWith(`${folder.uri.path}/`));
  const saved: ((document: unknown) => void)[] = [];
  const texts = new Map(options.notes.map((note) => [note.path, note.text]));
  const gates = [...(options.statGates ?? [])];
  const searches: { folder: string; glob: string; exclude: unknown }[] = [];
  const vscode = {
    Uri,
    RelativePattern,
    FileType: { File: 1 },
    workspace: {
      workspaceFolders: folders,
      getWorkspaceFolder: folderOf,
      asRelativePath: (uri: Uri) =>
        folderOf(uri)
          ? uri.path.slice(folderOf(uri)!.uri.path.length + 1)
          : uri.path,
      onDidSaveTextDocument: (listener: (document: unknown) => void) => {
        saved.push(listener);
        return { dispose: () => undefined };
      },
      createFileSystemWatcher: () => ({
        onDidCreate: () => ({ dispose: () => undefined }),
        onDidChange: () => ({ dispose: () => undefined }),
        onDidDelete: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
      }),
      getConfiguration: (section: string, uri: Uri) => ({
        get: (key: string) =>
          section === "files" && key === "exclude"
            ? options.filesExclude?.[uri.path]
            : undefined,
      }),
      findFiles: async (include: RelativePattern, exclude: unknown) => {
        searches.push({
          folder: include.base.uri.path,
          glob: include.pattern,
          exclude,
        });
        return options.notes
          .filter((note) => note.path.startsWith(`${include.base.uri.path}/`))
          .map((note) => new Uri(note.path));
      },
      fs: {
        readFile: async (uri: Uri) => Buffer.from(texts.get(uri.path) ?? ""),
        stat: async (uri: Uri) => {
          await gates.shift();
          if (!options.files.includes(uri.path)) {
            throw new Error("FileNotFound");
          }
          return { type: 1 };
        },
      },
    },
  };
  const files = loadModule(
    new URL("../../src/extension/plugins/pdf/files.ts", import.meta.url),
    {
      vscode,
      "node:crypto": crypto,
      "node:os": os,
      "node:path": path,
      "../../../host/atomic-write": { writeAtomicFile: async () => undefined },
      "../../../shared/annotation-store": annotationStore,
      "../../protected-folders": { isProtectedPdf: () => false },
    },
  );
  const { pdfBacklinksPlugin } = loadModule(
    new URL(
      "../../src/extension/plugins/pdfBacklinks/plugin.ts",
      import.meta.url,
    ),
    {
      vscode,
      "node:crypto": crypto,
      "../../../shared/backlink-note-uri": backlinkNoteUri,
      "../../../shared/markdown-scan": markdownScan,
      "../../../shared/pdf-backlink-index": backlinkIndex,
      "../pdf/files": files,
      "./manifest": { default: { id: "pdfBacklinks" } },
    },
  ) as { pdfBacklinksPlugin: { apply(ctx: unknown): void } };
  const panels: FakePanel[] = options.viewers.map((viewer) => {
    const panel: FakePanel = {
      uri: new Uri(viewer),
      received: [],
      backlinks: {
        set: (hits) => panel.received.push(hits as never),
      },
    };
    return panel;
  });
  const owned: { dispose(): void }[] = [];
  const openListeners: ((panel: FakePanel) => void)[] = [];
  const reads: string[] = [];
  const readFile = vscode.workspace.fs.readFile;
  vscode.workspace.fs.readFile = async (uri: Uri) => {
    reads.push(uri.path);
    return readFile(uri);
  };
  pdfBacklinksPlugin.apply({
    pdfPanels: {
      all: panels,
      onDidOpen: (listener: (panel: FakePanel) => void) => {
        openListeners.push(listener);
        return { dispose: () => undefined };
      },
      handle: () => ({ dispose: () => undefined }),
    },
    provide: () => undefined,
    own: (item: { dispose(): void }) => {
      owned.push(item);
      return item;
    },
  });
  return {
    panels,
    searches,
    reads,
    /** A PDF opens in a new viewer. */
    open: (viewer: string) => {
      const panel: FakePanel = {
        uri: new Uri(viewer),
        received: [],
        backlinks: { set: (hits) => panel.received.push(hits as never) },
      };
      panels.push(panel);
      for (const listener of openListeners) {
        listener(panel);
      }
      return panel;
    },
    /** Save a note with new text, as VS Code reports it. */
    save: (note: FakeNote) => {
      texts.set(note.path, note.text);
      for (const listener of saved) {
        listener({ uri: new Uri(note.path), getText: () => note.text });
      }
    },
    stop: () => owned.forEach((item) => item.dispose()),
  };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 40; tick++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  // Pushes wait for changes to stop coming (`PUSH_DELAY_MS`).
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (let tick = 0; tick < 40; tick++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const summary = (panel: FakePanel) =>
  (panel.received.at(-1) ?? []).map((hit) => [hit.noteUri, hit.page]);

test("in a multi-root workspace a note's link reaches only its own folder's PDF", async () => {
  const app = launch({
    notes: [
      { path: "/A/notes/n.md", text: "[x](papers/a.pdf#page=1)" },
      { path: "/B/notes/n.md", text: "[y](papers/a.pdf#page=2)" },
    ],
    files: ["/A/papers/a.pdf", "/B/papers/a.pdf"],
    viewers: ["/A/papers/a.pdf", "/B/papers/a.pdf"],
  });
  await settle();
  assert.deepEqual(summary(app.panels[0]!), [["file:///A/notes/n.md", 1]]);
  assert.deepEqual(summary(app.panels[1]!), [["file:///B/notes/n.md", 2]]);
});

test("a foldered link reaches the vault-root PDF, and the note's folder only without one", async () => {
  const notes = [{ path: "/A/notes/n.md", text: "[x](papers/a.pdf#page=3)" }];
  const both = launch({
    notes,
    files: ["/A/papers/a.pdf", "/A/notes/papers/a.pdf"],
    viewers: ["/A/papers/a.pdf", "/A/notes/papers/a.pdf"],
  });
  await settle();
  assert.deepEqual(summary(both.panels[0]!), [["file:///A/notes/n.md", 3]]);
  assert.deepEqual(summary(both.panels[1]!), []);

  const beside = launch({
    notes,
    files: ["/A/notes/papers/a.pdf"],
    viewers: ["/A/notes/papers/a.pdf"],
  });
  await settle();
  assert.deepEqual(summary(beside.panels[0]!), [["file:///A/notes/n.md", 3]]);
});

function gate(): { opens: Promise<void>; open: () => void } {
  let open!: () => void;
  const opens = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opens, open };
}

const NOTE = { path: "/A/notes/n.md", text: "[x](papers/a.pdf#page=1)" };

test("a push that finishes late does not overwrite a newer one", async () => {
  const slow = gate();
  const app = launch({
    folders: ["/A"],
    notes: [NOTE],
    files: [],
    viewers: ["/A/notes/papers/a.pdf"],
    // The first look for the vault-root file (the scan's push) is slow.
    statGates: [slow.opens],
  });
  await settle();
  app.save({ ...NOTE, text: "[x](papers/a.pdf#page=2)" });
  await settle();
  assert.deepEqual(summary(app.panels[0]!), [["file:///A/notes/n.md", 2]]);
  const received = app.panels[0]!.received.length;
  slow.open();
  await settle();
  assert.equal(
    app.panels[0]!.received.length,
    received,
    "the old push is dropped",
  );
});

test("a push that finishes after the plugin stopped posts nothing", async () => {
  const slow = gate();
  const app = launch({
    folders: ["/A"],
    notes: [NOTE],
    files: [],
    viewers: ["/A/notes/papers/a.pdf"],
    statGates: [slow.opens],
  });
  await settle();
  const received = app.panels[0]!.received.length;
  app.stop();
  slow.open();
  await settle();
  assert.equal(app.panels[0]!.received.length, received);
});

test("no note is read until a PDF opens", async () => {
  const app = launch({
    folders: ["/A"],
    notes: [NOTE],
    files: [],
    viewers: [],
  });
  await settle();
  assert.deepEqual(app.searches, []);
  assert.deepEqual(app.reads, []);
  const panel = app.open("/A/notes/papers/a.pdf");
  await settle();
  assert.equal(app.searches.length, 1);
  assert.deepEqual(summary(panel), [["file:///A/notes/n.md", 1]]);
});

test("a saved note is indexed once, and one without PDF links pushes nothing", async () => {
  const app = launch({
    folders: ["/A"],
    notes: [NOTE],
    files: [],
    viewers: ["/A/notes/papers/a.pdf"],
  });
  await settle();
  const pushes = app.panels[0]!.received.length;
  app.save({ path: "/A/notes/plain.md", text: "no links here" });
  app.save({ path: "/A/notes/plain.md", text: "still none" });
  await settle();
  assert.equal(app.panels[0]!.received.length, pushes);
  // The same text again (the watcher's change after a save) is not new.
  app.save({ ...NOTE, text: "[x](papers/a.pdf#page=5)" });
  app.save({ ...NOTE, text: "[x](papers/a.pdf#page=5)" });
  await settle();
  assert.equal(app.panels[0]!.received.length, pushes + 1);
  assert.deepEqual(summary(app.panels[0]!), [["file:///A/notes/n.md", 5]]);
});

test("each folder is searched for .md and .markdown, keeping its own files.exclude", async () => {
  const app = launch({
    notes: [],
    files: [],
    viewers: ["/A/papers/a.pdf"],
    filesExclude: {
      "/A": { "**/.git": true, "**/drafts": true, "**/shown": false },
      "/B": { "**/gen": { when: "$(basename).ts" } },
    },
  });
  await settle();
  assert.deepEqual(app.searches, [
    {
      folder: "/A",
      glob: "**/*.{md,markdown}",
      exclude: "{**/node_modules/**,**/.git/**,**/.git,**/drafts}",
    },
    {
      folder: "/B",
      glob: "**/*.{md,markdown}",
      exclude: "{**/node_modules/**,**/.git/**}",
    },
  ]);
});

test("a .markdown note is indexed from the scan and when saved", async () => {
  const scanned = { path: "/A/notes/scanned.markdown", text: NOTE.text };
  const app = launch({
    folders: ["/A"],
    notes: [scanned],
    files: ["/A/papers/a.pdf"],
    viewers: ["/A/papers/a.pdf"],
  });
  await settle();
  assert.deepEqual(summary(app.panels[0]!), [
    ["file:///A/notes/scanned.markdown", 1],
  ]);
  app.save({
    path: "/A/notes/saved.markdown",
    text: "[y](papers/a.pdf#page=4)",
  });
  await settle();
  assert.deepEqual(
    summary(app.panels[0]!).map(([, page]) => page),
    [1, 4],
  );
});
