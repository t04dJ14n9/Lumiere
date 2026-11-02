import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as format from "../../src/shared/sidecar-format";
import * as placement from "../../src/shared/sidecar-path";

/**
 * Plugin pdfSidecar's `Sidecars` against an in-memory workspace: the real
 * module, with only the VS Code API replaced.
 */

class Uri {
  constructor(readonly path: string) {}
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

class Disposable {
  constructor(private readonly callback: () => void) {}
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => items.forEach((item) => item.dispose()));
  }
  dispose(): void {
    this.callback();
  }
}

class FileSystemError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const highlight = (id: string, page = 1): format.SidecarHighlight => ({
  id,
  page,
  subtype: "highlight",
  color: "#FFE566",
  opacity: 0.45,
  segmentRects: [
    { x: 72, y: 88, w: 62, h: 14 },
    { x: 72, y: 104, w: 40, h: 14 },
  ],
  quote: "Synthetic",
  contextBefore: "",
  contextAfter: " page",
  created: "2026-11-01T18:00:00.000Z",
  modified: "2026-11-01T18:00:00.000Z",
});

function harness(settings: Record<string, unknown> = {}) {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const watchers: { disposed: boolean }[] = [];
  const vscode = {
    Uri,
    Disposable,
    FileSystemError,
    RelativePattern: class {
      constructor(
        readonly base: Uri,
        readonly pattern: string,
      ) {}
    },
    workspace: {
      textDocuments: [],
      getConfiguration: () => ({ get: (key: string) => settings[key] }),
      getWorkspaceFolder: (uri: Uri) =>
        uri.path.startsWith("/work/") ? { uri: new Uri("/work") } : undefined,
      asRelativePath: (uri: Uri) => uri.path.replace(/^\/work\//, ""),
      createFileSystemWatcher: () => {
        const watcher = { disposed: false };
        watchers.push(watcher);
        const noop = () => new Disposable(() => undefined);
        return {
          onDidCreate: noop,
          onDidChange: noop,
          onDidDelete: noop,
          dispose: () => (watcher.disposed = true),
        };
      },
      fs: {
        stat: async (uri: Uri) => {
          if (!files.has(uri.path)) {
            throw new FileSystemError("FileNotFound");
          }
          return {};
        },
        readFile: async (uri: Uri) => {
          const text = files.get(uri.path);
          if (text === undefined) {
            throw new FileSystemError("FileNotFound");
          }
          return new TextEncoder().encode(text);
        },
        writeFile: async (uri: Uri, data: Uint8Array) => {
          files.set(uri.path, new TextDecoder().decode(data));
        },
        createDirectory: async () => undefined,
      },
    },
    window: {
      showWarningMessage: async (message: string) => {
        warnings.push(message);
      },
    },
  };
  const loaded = new Map<string, unknown>();
  const load = (file: string): unknown => {
    if (!loaded.has(file)) {
      const source = readFileSync(
        new URL(
          `../../src/extension/plugins/pdfSidecar/${file}.ts`,
          import.meta.url,
        ),
        "utf8",
      );
      const output = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
      const module = { exports: {} as Record<string, unknown> };
      const modules: Record<string, () => unknown> = {
        vscode: () => vscode,
        "../../../shared/sidecar-format": () => format,
        "../../../shared/sidecar-path": () => placement,
        "./document": () => load("document"),
        "./location": () => load("location"),
      };
      (
        runInNewContext(`(function(require, module, exports) { ${output}\n})`, {
          TextDecoder,
          TextEncoder,
        }) as (
          require: (id: string) => unknown,
          module: unknown,
          exports: unknown,
        ) => void
      )(
        (id) => {
          assert.ok(id in modules, `Unexpected runtime dependency: ${id}`);
          return modules[id]!();
        },
        module,
        module.exports,
      );
      loaded.set(file, module.exports);
    }
    return loaded.get(file);
  };
  const { Sidecars } = load("sidecars") as {
    Sidecars: new () => {
      open(panel: unknown): void;
      close(panel: unknown): void;
      write(panel: unknown, message: unknown): Promise<void>;
      reveal(panel: unknown, id: string): Promise<void>;
      dispose(): void;
    };
  };
  const panel = (file: string) => {
    const shown: (format.SidecarHighlight[] | null)[] = [];
    const jumps: unknown[] = [];
    return {
      uri: new Uri(file),
      setSidecar: (highlights: format.SidecarHighlight[] | null) =>
        shown.push(highlights),
      goTo: (location: unknown) => jumps.push(location),
      shown,
      jumps,
    };
  };
  return { files, warnings, watchers, sidecars: new Sidecars(), panel };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Objects made inside the module's sandbox, comparable with this realm's. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("a PDF's sidecar beside it is read and shown, and a write creates it", async () => {
  const h = harness();
  const pdf = h.panel("/work/papers/paper.pdf");
  h.sidecars.open(pdf);
  await settle();
  assert.deepEqual(plain(pdf.shown), [[]], "no sidecar yet: no highlights");
  await h.sidecars.write(pdf, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-1"),
  });
  const text = h.files.get("/work/papers/paper.pdf.lumiere.md")!;
  assert.match(text, /^---\nlumiere-pdf-sidecar: 1\nsource: "paper.pdf"\n---/);
  assert.deepEqual(format.parseSidecar(text).highlights, [highlight("hl-1")]);
  assert.deepEqual(pdf.shown.at(-1), [highlight("hl-1")]);
  // Another editor of the same PDF follows.
  const twin = h.panel("/work/papers/paper.pdf");
  h.sidecars.open(twin);
  await settle();
  await h.sidecars.write(pdf, {
    type: "sidecarWrite",
    load: 1,
    op: "delete",
    id: "hl-1",
  });
  assert.deepEqual(plain(twin.shown.at(-1)), []);
  assert.doesNotMatch(
    h.files.get("/work/papers/paper.pdf.lumiere.md")!,
    /hl-1/,
  );
  h.sidecars.dispose();
  assert.deepEqual(pdf.shown.at(-1), null, "stopping takes them off the pages");
  assert.ok(h.watchers.every((watcher) => watcher.disposed));
});

test("a #hl- link goes to the highlight's box; a missing one says so", async () => {
  const h = harness();
  h.files.set(
    "/work/paper.pdf.lumiere.md",
    format.createSidecar({ source: "paper.pdf" }, [highlight("hl-2", 4)]),
  );
  const pdf = h.panel("/work/paper.pdf");
  // The link can arrive while the editor is still finding its sidecar.
  h.sidecars.open(pdf);
  await h.sidecars.reveal(pdf, "hl-2");
  assert.deepEqual(plain(pdf.jumps), [
    { page: 4, viewRect: { left: 72, top: 88, width: 62, height: 30 } },
  ]);
  await h.sidecars.reveal(pdf, "hl-gone");
  assert.match(
    h.warnings.at(-1)!,
    /No highlight hl-gone in paper\.pdf\.lumiere\.md/,
  );
  assert.equal(h.watchers.length, 1, "one search, one watcher");
});

test("in a sidecar folder, another PDF's sidecar of the same name is neither shown nor written", async () => {
  const h = harness({
    "lumiere.pdf.sidecar.location": "directory",
    "lumiere.pdf.sidecar.directory": "notes/sidecars",
  });
  const theirs = format.createSidecar(
    { source: "paper.pdf", path: "a/paper.pdf" },
    [highlight("hl-a")],
  );
  h.files.set("/work/notes/sidecars/paper.pdf.lumiere.md", theirs);
  const pdf = h.panel("/work/b/paper.pdf");
  h.sidecars.open(pdf);
  await settle();
  assert.deepEqual(plain(pdf.shown), [[]]);
  await h.sidecars.write(pdf, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-b"),
  });
  assert.equal(
    h.files.get("/work/notes/sidecars/paper.pdf.lumiere.md"),
    theirs,
  );
  assert.match(h.warnings.at(-1)!, /belongs to another PDF/);
  // Its own sidecar in the folder records its path.
  const other = h.panel("/work/c/other.pdf");
  h.sidecars.open(other);
  await settle();
  await h.sidecars.write(other, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-c"),
  });
  assert.equal(
    format.parseSidecar(
      h.files.get("/work/notes/sidecars/other.pdf.lumiere.md")!,
    ).path,
    "c/other.pdf",
  );
});

test("an old sidecar beside the PDF stays in use after switching to a folder; a bad folder falls back", async () => {
  const sibling = harness({
    "lumiere.pdf.sidecar.location": "directory",
    "lumiere.pdf.sidecar.directory": "notes",
  });
  sibling.files.set(
    "/work/paper.pdf.lumiere.md",
    format.createSidecar({ source: "paper.pdf" }, [highlight("hl-old")]),
  );
  const pdf = sibling.panel("/work/paper.pdf");
  sibling.sidecars.open(pdf);
  await settle();
  assert.deepEqual(pdf.shown.at(-1), [highlight("hl-old")]);
  await sibling.sidecars.write(pdf, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-new"),
  });
  assert.equal(sibling.files.has("/work/notes/paper.pdf.lumiere.md"), false);
  assert.match(sibling.files.get("/work/paper.pdf.lumiere.md")!, /hl-new/);

  const bad = harness({
    "lumiere.pdf.sidecar.location": "directory",
    "lumiere.pdf.sidecar.directory": "../outside",
  });
  const elsewhere = bad.panel("/work/x.pdf");
  bad.sidecars.open(elsewhere);
  bad.sidecars.open(bad.panel("/work/y.pdf"));
  await settle();
  await bad.sidecars.write(elsewhere, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-x"),
  });
  assert.ok(bad.files.has("/work/x.pdf.lumiere.md"));
  assert.equal(bad.warnings.length, 1, "said once, not per editor");
  assert.match(bad.warnings[0]!, /leaves the workspace/);
});
