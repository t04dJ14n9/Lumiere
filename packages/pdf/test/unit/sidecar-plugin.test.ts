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

function harness(
  settings: Record<string, unknown> = {},
  options: { holdLocate?: boolean } = {},
) {
  let releaseLocate = (): void => undefined;
  const locateHeld = options.holdLocate
    ? new Promise<void>((resolve) => {
        releaseLocate = resolve;
      })
    : null;
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
  // Wrap locate before Sidecars loads so attach can stay pending under test.
  const locationExports = load("location") as {
    locateSidecar: (
      pdf: Uri,
      warn: (message: string) => void,
    ) => Promise<unknown>;
  };
  if (locateHeld) {
    const inner = locationExports.locateSidecar;
    locationExports.locateSidecar = async (pdf, warn) => {
      await locateHeld;
      return inner(pdf, warn);
    };
  }
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
  return {
    files,
    warnings,
    watchers,
    sidecars: new Sidecars(),
    panel,
    releaseLocate,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Objects made inside the module's sandbox, comparable with this realm's. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("upsert during delayed locate is ignored and creates no sidecar", async () => {
  const h = harness({}, { holdLocate: true });
  const pdf = h.panel("/work/papers/paper.pdf");
  h.sidecars.open(pdf);
  assert.deepEqual(
    plain(pdf.shown),
    [[]],
    "open still claims [] while locate is held",
  );

  const writing = h.sidecars.write(pdf, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-during-attach"),
  });
  h.releaseLocate();
  await writing;

  assert.equal(
    h.files.has("/work/papers/paper.pdf.lumiere.md"),
    false,
    "create/write teardown must not persist upserts",
  );
  assert.deepEqual(
    plain(pdf.shown.at(-1)),
    [],
    "panel stays empty when no sidecar exists on disk",
  );
  h.sidecars.dispose();
});

test("open still reads a pre-existing sidecar before locate finishes", async () => {
  const h = harness();
  h.files.set(
    "/work/papers/paper.pdf.lumiere.md",
    format.createSidecar({ source: "paper.pdf" }, [highlight("hl-race")]),
  );
  const pdf = h.panel("/work/papers/paper.pdf");
  h.sidecars.open(pdf);
  // open() returns before attach awaits locate/read; [] claims ownership for legacy read.
  assert.deepEqual(
    plain(pdf.shown),
    [[]],
    "open must setSidecar([]) before any await while pdfSidecar owns the panel",
  );
  await settle();
  assert.deepEqual(
    pdf.shown.at(-1),
    [highlight("hl-race")],
    "reload still replaces the pending claim with real highlights",
  );
  h.sidecars.dispose();
  assert.equal(pdf.shown.at(-1), null);
});

test("a PDF's sidecar beside it is read; upsert no longer creates or changes it", async () => {
  const h = harness();
  const pdf = h.panel("/work/papers/paper.pdf");
  h.sidecars.open(pdf);
  await settle();
  assert.deepEqual(
    plain(pdf.shown.at(-1)),
    [],
    "no sidecar yet: no highlights",
  );
  await h.sidecars.write(pdf, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-1"),
  });
  assert.equal(
    h.files.has("/work/papers/paper.pdf.lumiere.md"),
    false,
    "upsert must not create a sidecar after create-path teardown",
  );
  assert.deepEqual(plain(pdf.shown.at(-1)), []);

  const existing = format.createSidecar({ source: "paper.pdf" }, [
    highlight("hl-old"),
  ]);
  h.files.set("/work/papers/paper.pdf.lumiere.md", existing);
  const twin = h.panel("/work/papers/paper.pdf");
  h.sidecars.open(twin);
  await settle();
  assert.deepEqual(twin.shown.at(-1), [highlight("hl-old")]);
  await h.sidecars.write(twin, {
    type: "sidecarWrite",
    load: 1,
    op: "upsert",
    highlight: highlight("hl-new"),
  });
  assert.equal(
    h.files.get("/work/papers/paper.pdf.lumiere.md"),
    existing,
    "upsert must leave a pre-existing sidecar untouched",
  );
  assert.deepEqual(twin.shown.at(-1), [highlight("hl-old")]);
  h.sidecars.dispose();
  assert.deepEqual(pdf.shown.at(-1), null, "stopping clears the panel claim");
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

test("in a sidecar folder, another PDF's sidecar of the same name is not shown; upserts stay no-ops", async () => {
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
  assert.deepEqual(plain(pdf.shown.at(-1)), []);
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
  assert.equal(h.warnings.length, 0, "ignored upserts must not warn");
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
    h.files.has("/work/notes/sidecars/other.pdf.lumiere.md"),
    false,
    "upsert must not create a folder sidecar after teardown",
  );
});

test("an old sidecar beside the PDF stays readable after switching to a folder; upserts stay no-ops", async () => {
  const sibling = harness({
    "lumiere.pdf.sidecar.location": "directory",
    "lumiere.pdf.sidecar.directory": "notes",
  });
  const existing = format.createSidecar({ source: "paper.pdf" }, [
    highlight("hl-old"),
  ]);
  sibling.files.set("/work/paper.pdf.lumiere.md", existing);
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
  assert.equal(
    sibling.files.get("/work/paper.pdf.lumiere.md"),
    existing,
    "upsert must not rewrite a legacy sibling sidecar",
  );

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
  assert.equal(
    bad.files.has("/work/x.pdf.lumiere.md"),
    false,
    "ignored upsert must not fall back to creating a sibling sidecar",
  );
  // Locating a bad folder still warns once for read path.
  assert.equal(bad.warnings.length, 1, "said once, not per editor");
  assert.match(bad.warnings[0]!, /leaves the workspace/);
});

test("sidecarWrite delete leaves a pre-existing sidecar untouched", async () => {
  const h = harness();
  const existing = format.createSidecar({ source: "paper.pdf" }, [
    highlight("hl-keep"),
  ]);
  h.files.set("/work/papers/paper.pdf.lumiere.md", existing);
  const pdf = h.panel("/work/papers/paper.pdf");
  h.sidecars.open(pdf);
  await settle();
  assert.deepEqual(pdf.shown.at(-1), [highlight("hl-keep")]);
  await h.sidecars.write(pdf, {
    type: "sidecarWrite",
    load: 1,
    op: "delete",
    id: "hl-keep",
  });
  assert.equal(
    h.files.get("/work/papers/paper.pdf.lumiere.md"),
    existing,
    "delete must not mutate sidecar after write teardown",
  );
  assert.deepEqual(
    pdf.shown.at(-1),
    [highlight("hl-keep")],
    "ignored delete must not clear the in-memory claim from disk",
  );
  h.sidecars.dispose();
});
