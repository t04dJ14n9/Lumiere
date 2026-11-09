import assert from "node:assert/strict";
import test from "node:test";
import {
  createScratchNote,
  promoteScratchNote,
} from "../../../src/plugins/scratch/run";
import type { ScratchIO } from "../../../src/plugins/scratch/run";
import type { HostDocument, TextEdit } from "../../../src/shared/host";
import type { WorkspaceFiles } from "../../../src/shared/workspace-files";

const ROOT = "file:///project";
const SCRATCH = "scratch/Draft.md";
const CONCEPT = { type: "Concept", logical: "concepts" };

function memoryFiles(written: Map<string, string>): WorkspaceFiles {
  return {
    async readText(uri) {
      return written.get(uri);
    },
    async writeText(uri, text) {
      written.set(uri, text);
    },
    async createText(uri, text) {
      if (written.has(uri)) {
        return false;
      }
      written.set(uri, text);
      return true;
    },
    async writeBytes() {},
    async list(uri) {
      const prefix = `${uri}/`;
      return [...written.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
    async mkdir() {},
    async copy() {},
    async move() {},
    async remove() {},
    async isSymbolicLink() {
      return false;
    },
    async pickFile() {
      return undefined;
    },
  };
}

function scratchDocument(text: string): HostDocument {
  return {
    id: "1",
    uri: `${ROOT}/${SCRATCH}`,
    version: 1,
    isDirty: false,
    isUntitled: false,
    eol: "\n",
    getText: () => text,
    save: async () => true,
  };
}

function scratchIO(
  written: Map<string, string>,
  applied: TextEdit[][],
): ScratchIO {
  return {
    files: memoryFiles(written),
    rootUri: ROOT,
    execute: async () => undefined,
    apply: async (_document, edits) => {
      applied.push([...edits]);
      return true;
    },
    inform() {},
    error(message) {
      throw new Error(message);
    },
  };
}

test("the stub links to the promoted page with one link", async () => {
  const applied: TextEdit[][] = [];
  const text = "---\ntitle: Draft\n---\nA definition.\n";
  await promoteScratchNote(scratchIO(new Map(), applied), {
    target: CONCEPT,
    title: "Draft",
    text,
    at: "2026-10-11T01:00:00.000Z",
    scratchRelative: SCRATCH,
    document: scratchDocument(text),
  });
  assert.match(
    applied[0]?.[0]?.insert ?? "",
    /\nPromoted to \[Draft\]\(\.\.\/knowledge\/concepts\/draft\.md\)\.\n/,
  );
});

/** The first two listings both answer before either client writes, as two clients of one vault would see. */
function listingsBeforeWrites(files: WorkspaceFiles): WorkspaceFiles {
  const waiting: (() => void)[] = [];
  let listings = 0;
  return {
    ...files,
    async list(uri) {
      const names = await files.list(uri);
      listings += 1;
      if (listings > 2) {
        return names;
      }
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === 2) {
          waiting.forEach((release) => release());
        }
      });
      return names;
    },
  };
}

test("two promotions of notes with the same title keep both pages", async () => {
  const written = new Map<string, string>();
  const applied: TextEdit[][] = [];
  const io = {
    ...scratchIO(written, applied),
    files: listingsBeforeWrites(memoryFiles(written)),
  };
  const promote = (body: string) => {
    const text = `---\ntitle: Draft\n---\n${body}\n`;
    return promoteScratchNote(io, {
      target: CONCEPT,
      title: "Draft",
      text,
      at: "2026-10-11T01:00:00.000Z",
      scratchRelative: SCRATCH,
      document: scratchDocument(text),
    });
  };
  await Promise.all([promote("First body."), promote("Second body.")]);
  const pages = [...written.entries()].filter(([uri]) =>
    uri.includes("/knowledge/concepts/"),
  );
  assert.equal(pages.length, 2);
  assert.match(pages.map(([, page]) => page).join("\n"), /First body\./);
  assert.match(pages.map(([, page]) => page).join("\n"), /Second body\./);
  const links = applied.map((edits) => edits[0]?.insert ?? "");
  assert.notEqual(links[0], links[1]);
});

test("two new scratch notes with the same title keep both notes", async () => {
  const written = new Map<string, string>();
  const io = {
    ...scratchIO(written, []),
    files: listingsBeforeWrites(memoryFiles(written)),
  };
  const create = (at: string) =>
    createScratchNote(io, { title: "Idea", at, folder: "scratch" });
  await Promise.all([
    create("2026-10-11T01:00:00.000Z"),
    create("2026-10-11T01:00:01.000Z"),
  ]);
  assert.equal(written.size, 2);
});

test("promoting leaves a note that changed during the write as it is", async () => {
  const snapshot = "---\ntitle: Draft\n---\nInitial body.\n";
  let current = snapshot;
  const written = new Map<string, string>();
  const applied: TextEdit[][] = [];
  const errors: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const files = memoryFiles(written);
  const io: ScratchIO = {
    ...scratchIO(written, applied),
    files: {
      ...files,
      async createText(uri, text) {
        await held;
        return files.createText(uri, text);
      },
    },
    error: (message) => errors.push(message),
  };
  const promoting = promoteScratchNote(io, {
    target: CONCEPT,
    title: "Draft",
    text: snapshot,
    at: "2026-10-11T01:00:00.000Z",
    scratchRelative: SCRATCH,
    document: { ...scratchDocument(snapshot), getText: () => current },
  });
  // The page is still being written: the user keeps typing in the note.
  current = `${current}Typed meanwhile.\n`;
  release();
  await promoting;
  assert.match([...written.values()][0] ?? "", /Initial body\./);
  assert.deepEqual(applied, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /knowledge\/concepts\/draft\.md/);
  assert.match(errors[0] ?? "", /changed/);
});
