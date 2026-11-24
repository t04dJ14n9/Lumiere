import test from "node:test";
import assert from "node:assert/strict";
import { VaultIndexer } from "../../../src/plugins/vault/indexer";
import { MemoryFileSystem, indexerOptions } from "./memory-fs";

/**
 * An indexer whose limit is two notes and two other files, with the four
 * of them created after its listing: events fill the index as a listing does.
 */
async function fullVault() {
  const fs = new MemoryFileSystem();
  let partials = 0;
  const indexer = new VaultIndexer({
    ...indexerOptions(fs),
    listingLimit: 2,
    onPartial: () => partials++,
  });
  await indexer.settled();
  for (const path of ["A.md", "B.md", "a.png", "b.png"]) {
    fs.create(path, "");
  }
  assert.equal(indexer.index.files().length, 4);
  return { fs, indexer, partials: () => partials };
}

test("a new note is not indexed once the vault holds the limit of notes, and the vault says so once", async () => {
  const { fs, indexer, partials } = await fullVault();

  fs.create("C.md", "third");
  fs.create("D.md", "fourth");

  assert.equal(indexer.index.file("C.md"), undefined);
  assert.equal(indexer.index.file("D.md"), undefined);
  assert.equal(indexer.index.files().length, 4);
  assert.equal(partials(), 1);
  await indexer.dispose();
});

test("a full vault still follows the files it has: changes, renames and deletes", async () => {
  const { fs, indexer, partials } = await fullVault();

  fs.change("A.md", "changed");
  fs.rename("B.md", "Renamed.md");
  fs.delete("a.png");

  assert.ok(indexer.index.file("Renamed.md"));
  assert.equal(indexer.index.file("B.md"), undefined);
  assert.equal(indexer.index.file("a.png"), undefined);
  assert.equal(partials(), 0);

  // A freed place is taken by the next new file of its kind.
  fs.create("c.png", "");
  assert.ok(indexer.index.file("c.png"));
  await indexer.dispose();
});

test("notes and other files are limited apart, as a listing does", async () => {
  const fs = new MemoryFileSystem();
  const indexer = new VaultIndexer({ ...indexerOptions(fs), listingLimit: 2 });
  await indexer.settled();
  fs.create("A.md", "");
  fs.create("B.md", "");

  fs.create("image.png", "");

  assert.ok(indexer.index.file("image.png"), "other files do not count notes");
  await indexer.dispose();
});

test("a file moved in from where the index has none counts as a new file", async () => {
  const { fs, indexer } = await fullVault();
  fs.put(".hidden/Moved.md", "");

  fs.rename(".hidden/Moved.md", "Moved.md");

  assert.equal(indexer.index.file("Moved.md"), undefined);
  await indexer.dispose();
});
