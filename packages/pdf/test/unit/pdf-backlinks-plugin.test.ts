/**
 * Plugin pdfBacklinks, run as written against a fake VS Code: which notes'
 * links reach which open viewer.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import * as backlinkNoteUri from "../../src/shared/backlink-note-uri";
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
  const vscode = {
    Uri,
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
      findFiles: async () => options.notes.map((note) => new Uri(note.path)),
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
      "node:path": path,
      "../../../host/atomic-write": { writeAtomicFile: async () => undefined },
    },
  );
  const { pdfBacklinksPlugin } = loadModule(
    new URL(
      "../../src/extension/plugins/pdfBacklinks/plugin.ts",
      import.meta.url,
    ),
    {
      vscode,
      "../../../shared/backlink-note-uri": backlinkNoteUri,
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
  pdfBacklinksPlugin.apply({
    pdfPanels: {
      all: panels,
      onDidOpen: () => ({ dispose: () => undefined }),
      handle: () => ({ dispose: () => undefined }),
    },
    provide: () => undefined,
    own: (item: { dispose(): void }) => owned.push(item),
  });
  return {
    panels,
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
