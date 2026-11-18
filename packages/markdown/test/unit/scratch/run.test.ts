import assert from "node:assert/strict";
import test from "node:test";
import { createScratchNote } from "../../../src/plugins/scratch/run";
import type { ScratchIO } from "../../../src/plugins/scratch/run";
import type { WorkspaceFiles } from "../../../src/shared/workspace-files";

const ROOT = "file:///project";

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
    async createBytes() {
      return true;
    },
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

function scratchIO(written: Map<string, string>): ScratchIO {
  return {
    files: memoryFiles(written),
    rootUri: ROOT,
    execute: async () => undefined,
    inform() {},
    error(message) {
      throw new Error(message);
    },
  };
}

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

test("two new scratch notes with the same title keep both notes", async () => {
  const written = new Map<string, string>();
  const io = {
    ...scratchIO(written),
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
