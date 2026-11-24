import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import type { OutlineSection } from "../../src/shared/outline-sections";
import type { OutlineEngine } from "../../src/extension/outlines/engine";
import {
  containingFolder,
  insideFolders,
} from "../../src/extension/outlines/inside-folders";
import {
  MAX_OUTLINE_PDF_BYTES,
  PdfOutlineReader,
  type OutlineFiles,
} from "../../src/extension/outlines/reader";

interface Stamp {
  mtime: number;
  size: number;
}

/** Files, an engine and a log, all recording what the reader does with them. */
function setup(pdfs: Record<string, Stamp>) {
  const stamps = new Map(Object.entries(pdfs));
  const calls = {
    stat: 0,
    read: [] as string[],
    engines: 0,
    disposed: 0,
    opened: [] as string[],
    log: [] as string[],
  };
  let running = 0;
  let overlap = false;
  const gate = { wait: Promise.resolve() as Promise<unknown> };
  const readGate = { wait: Promise.resolve() as Promise<unknown> };
  const files: OutlineFiles = {
    async stat(uri) {
      calls.stat++;
      return stamps.get(uri);
    },
    async read(uri) {
      calls.read.push(uri);
      await readGate.wait;
      return new TextEncoder().encode(uri);
    },
  };
  const engine = async (): Promise<OutlineEngine> => {
    calls.engines++;
    return {
      async sections(bytes) {
        const uri = new TextDecoder().decode(bytes);
        calls.opened.push(uri);
        overlap ||= ++running > 1;
        await gate.wait;
        running--;
        if (uri.includes("broken")) {
          throw new Error("FPDF_LoadMemDocument failed");
        }
        return [{ title: `Title of ${uri}`, page: 1, depth: 0 }];
      },
      async dispose() {
        calls.disposed++;
      },
    };
  };
  const reader = new PdfOutlineReader({
    files,
    engine,
    log: (message) => calls.log.push(message),
  });
  return { reader, stamps, calls, gate, readGate, overlapped: () => overlap };
}

const titles = (sections: readonly OutlineSection[]) =>
  sections.map((section) => section.title);

test("PDFium starts with the first outline asked for, not before", async () => {
  const { reader, calls } = setup({ "file:///a.pdf": { mtime: 1, size: 10 } });
  assert.equal(calls.engines, 0);
  assert.deepEqual(titles(await reader.sections("file:///a.pdf")), [
    "Title of file:///a.pdf",
  ]);
  assert.equal(calls.engines, 1);
});

test("a PDF is read once while its modification time and size stay the same", async () => {
  const { reader, stamps, calls } = setup({
    "file:///a.pdf": { mtime: 1, size: 10 },
  });
  const first = await reader.sections("file:///a.pdf");
  assert.equal(await reader.sections("file:///a.pdf"), first);
  assert.equal(await reader.sections("file:///a.pdf"), first);
  assert.deepEqual(calls.read, ["file:///a.pdf"]);
  assert.equal(calls.stat, 3);
  stamps.set("file:///a.pdf", { mtime: 2, size: 10 });
  assert.notEqual(await reader.sections("file:///a.pdf"), first);
  stamps.set("file:///a.pdf", { mtime: 2, size: 11 });
  await reader.sections("file:///a.pdf");
  assert.equal(calls.read.length, 3);
  assert.equal(calls.engines, 1);
});

test("asking again while a PDF is being read shares that read; PDFium opens one at a time", async () => {
  const { reader, calls, gate, overlapped } = setup({
    "file:///a.pdf": { mtime: 1, size: 10 },
    "file:///b.pdf": { mtime: 1, size: 10 },
  });
  let release!: () => void;
  gate.wait = new Promise<void>((resolve) => (release = resolve));
  const pending = [
    reader.sections("file:///a.pdf"),
    reader.sections("file:///a.pdf"),
    reader.sections("file:///b.pdf"),
  ];
  // Let the stats and the first read start, then finish them all.
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const [first, again, other] = await Promise.all(pending);
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.deepEqual(calls.opened, ["file:///a.pdf", "file:///b.pdf"]);
  assert.equal(overlapped(), false);
});

test("a PDF that is missing, too large or unreadable has no sections, and the reader never rejects", async () => {
  const { reader, calls } = setup({
    "file:///huge.pdf": { mtime: 1, size: MAX_OUTLINE_PDF_BYTES + 1 },
    "file:///broken.pdf": { mtime: 1, size: 10 },
  });
  assert.deepEqual(await reader.sections("file:///gone.pdf"), []);
  assert.deepEqual(await reader.sections("file:///huge.pdf"), []);
  assert.deepEqual(calls.read, []);
  assert.deepEqual(await reader.sections("file:///broken.pdf"), []);
  assert.match(calls.log[0]!, /broken\.pdf.*FPDF_LoadMemDocument failed/);
  // The same bytes fail the same way: not opened again on every keystroke.
  await reader.sections("file:///broken.pdf");
  assert.equal(calls.opened.length, 1);
});

test("an engine that cannot start leaves every PDF without sections", async () => {
  const log: string[] = [];
  const reader = new PdfOutlineReader({
    files: {
      stat: async () => ({ mtime: 1, size: 1 }),
      read: async () => new Uint8Array(),
    },
    engine: async () => {
      throw new Error("outline-engine.js is missing");
    },
    log: (message) => log.push(message),
  });
  assert.deepEqual(await reader.sections("file:///a.pdf"), []);
  assert.match(log[0]!, /outline-engine\.js is missing/);
});

test("only the most recently asked PDFs are kept", async () => {
  const pdfs = Object.fromEntries(
    Array.from({ length: 40 }, (_, n) => [
      `file:///${n}.pdf`,
      { mtime: 1, size: 10 },
    ]),
  );
  const { reader, calls } = setup(pdfs);
  for (const uri of Object.keys(pdfs)) {
    await reader.sections(uri);
  }
  await reader.sections("file:///39.pdf");
  assert.equal(calls.read.length, 40);
  await reader.sections("file:///0.pdf");
  assert.equal(calls.read.length, 41);
});

test("after dispose nothing is read", async () => {
  const { reader, calls } = setup({ "file:///a.pdf": { mtime: 1, size: 10 } });
  await reader.sections("file:///a.pdf");
  reader.dispose();
  assert.deepEqual(await reader.sections("file:///a.pdf"), []);
  assert.equal(calls.read.length, 1);
});

test("disposing while the first PDF is being read leaves no PDFium running", async () => {
  const { reader, calls, readGate } = setup({
    "file:///a.pdf": { mtime: 1, size: 10 },
  });
  let release!: () => void;
  readGate.wait = new Promise<void>((resolve) => (release = resolve));
  const pending = reader.sections("file:///a.pdf");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.read, ["file:///a.pdf"]);
  reader.dispose();
  release();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.disposed, calls.engines);
});

async function bookmarksOnlyInsideWorkspace(t: TestContext, prefix: string) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  const outside = await realpath(
    await mkdtemp(path.join(tmpdir(), `${prefix}outside-`)),
  );
  t.after(() =>
    Promise.all([root, outside].map((dir) => rm(dir, { recursive: true }))),
  );
  await writeFile(path.join(root, "paper.pdf"), "inside");
  await writeFile(path.join(outside, "other.pdf"), "outside");
  await symlink(path.join(root, "paper.pdf"), path.join(root, "inner.pdf"));
  await symlink(path.join(outside, "other.pdf"), path.join(root, "link.pdf"));
  await symlink(outside, path.join(root, "linked-folder"));
  await mkdir(path.join(root, "sub"));
  const reads: string[] = [];
  const disk: OutlineFiles = {
    async stat(uri) {
      const { mtimeMs, size } = await stat(new URL(uri));
      return { mtime: mtimeMs, size };
    },
    async read(uri) {
      reads.push(uri);
      return readFile(new URL(uri));
    },
  };
  const reader = new PdfOutlineReader({
    files: insideFolders(disk, () => [root]),
    engine: async () => ({
      sections: async (bytes) => [
        { title: new TextDecoder().decode(bytes), page: 1, depth: 0 },
      ],
      dispose: async () => {},
    }),
    log: () => {},
  });
  const bookmarks = async (...parts: string[]) =>
    titles(await reader.sections(pathToFileURL(path.join(...parts)).href));

  assert.deepEqual(await bookmarks(root, "paper.pdf"), ["inside"]);
  // A link that stays inside the workspace is still its own file.
  assert.deepEqual(await bookmarks(root, "inner.pdf"), ["inside"]);
  assert.deepEqual(await bookmarks(root, "link.pdf"), []);
  assert.deepEqual(await bookmarks(root, "linked-folder", "other.pdf"), []);
  assert.deepEqual(await bookmarks(root, "sub", "missing.pdf"), []);
  // Only the two files inside the workspace were read, whatever the folder is called.
  assert.deepEqual(reads, [
    pathToFileURL(path.join(root, "paper.pdf")).href,
    pathToFileURL(path.join(root, "inner.pdf")).href,
  ]);
  // Where files have no real path, the editor's own file system decides.
  assert.deepEqual(
    titles(
      await new PdfOutlineReader({
        files: insideFolders(
          {
            stat: async () => ({ mtime: 1, size: 1 }),
            read: async () => new TextEncoder().encode("remote"),
          },
          () => [root],
        ),
        engine: async () => ({
          sections: async (bytes) => [
            { title: new TextDecoder().decode(bytes), page: 1, depth: 0 },
          ],
          dispose: async () => {},
        }),
        log: () => {},
      }).sections("vscode-vfs://github/repo/paper.pdf"),
    ),
    ["remote"],
  );
}

test("a PDF has bookmarks only when its real path is inside the workspace", (t) =>
  bookmarksOnlyInsideWorkspace(t, "outline-"));

test('a PDF has bookmarks only when its real path is inside the workspace, also when the temp folder\'s path contains "link"', (t) =>
  bookmarksOnlyInsideWorkspace(t, "outline-link-"));

test("the folder that holds a file is found by real paths, with where the file is in it", async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "outline-")));
  t.after(() => rm(base, { recursive: true }));
  const real = path.join(base, "real");
  const opened = path.join(base, "opened");
  const other = path.join(base, "other");
  await mkdir(path.join(real, "papers"), { recursive: true });
  await mkdir(other);
  await writeFile(path.join(real, "papers", "a.pdf"), "x");
  // The window opened the folder through a link; the file is named by its real path.
  await symlink(real, opened, "junction");
  const file = pathToFileURL(path.join(real, "papers", "a.pdf")).href;
  assert.deepEqual(await containingFolder([other, opened], file), {
    folder: opened,
    relative: path.join("papers", "a.pdf"),
  });
  assert.deepEqual(await containingFolder([other, real], file), {
    folder: real,
    relative: path.join("papers", "a.pdf"),
  });
  assert.equal(await containingFolder([other], file), undefined);
  assert.equal(
    await containingFolder(
      [real],
      pathToFileURL(path.join(real, "gone.pdf")).href,
    ),
    undefined,
  );
});
