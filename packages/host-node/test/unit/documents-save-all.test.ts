// An embedder whose window can go away under the host (a hidden or reloaded
// browser tab, the iPad app in the background) writes unsaved notes at once.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { NoteDocuments, noteFiles } from "../../src/host/documents";
import { createNodePlatform } from "../../src/host/node-platform";

const NODE_NOTES = noteFiles(
  createNodePlatform({ data: tmpdir(), workers: "" }),
);

test("saveAll writes unsaved text without waiting for autosave, and keeps notes open", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-save-all-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const [one, two] = ["One.md", "Two.md"].map((name) => path.join(dir, name));
  await writeFile(one!, "one");
  await writeFile(two!, "two");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(() => documents.dispose());
  const first = await documents.open(pathToFileURL(one!).href);
  await documents.open(pathToFileURL(two!).href);
  await documents.apply(first, [{ from: 3, to: 3, insert: "!" }]);

  await documents.saveAll();
  assert.equal(await readFile(one!, "utf8"), "one!");
  assert.equal(await readFile(two!, "utf8"), "two");
  assert.equal(first.isDirty, false);
  assert.equal(documents.text(pathToFileURL(one!).href), "one!");
});

test("saveAll reports a write that failed", async (t) => {
  const failing = {
    ...NODE_NOTES,
    save: () => Promise.reject(new Error("Disk full")),
  };
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-save-all-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "Note.md");
  await writeFile(file, "text");
  const documents = new NoteDocuments(failing, 60_000);
  const note = await documents.open(pathToFileURL(file).href);
  await documents.apply(note, [{ from: 0, to: 0, insert: "more " }]);
  await assert.rejects(documents.saveAll(), /Disk full/);
  assert.equal(note.isDirty, true);
  await documents.dispose().catch(() => {});
});
