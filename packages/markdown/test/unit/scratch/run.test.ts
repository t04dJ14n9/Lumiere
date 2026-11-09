import assert from "node:assert/strict";
import test from "node:test";
import { promoteScratchNote } from "../../../src/plugins/scratch/run";
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
