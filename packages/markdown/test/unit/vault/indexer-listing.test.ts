import test from "node:test";
import assert from "node:assert/strict";
import { VaultIndexer } from "../../../src/plugins/vault/indexer";
import type { FileEvent, VaultListing } from "../../../src/plugins/vault/api";
import { MemoryFileSystem, MemoryStore, indexerOptions } from "./memory-fs";

/** Counts how many times its watch is started and stopped. */
class CountingWatch extends MemoryFileSystem {
  starts = 0;
  stops = 0;
  override watch(root: string, listener: (event: FileEvent) => void) {
    this.starts++;
    const stop = super.watch(root, listener);
    return () => {
      this.stops++;
      stop();
    };
  }
}

/** A store whose first read waits for the test, so an indexer can be disposed while it loads. */
class GatedStore extends MemoryStore {
  gate?: Promise<void>;
  override async read(name: string): Promise<string | undefined> {
    await this.gate;
    return super.read(name);
  }
}

/**
 * A file system that changes the vault after its listing is taken, as a
 * write that races the first listing does: the listing predates the change.
 */
class ChangingDuringListing extends MemoryFileSystem {
  constructor(
    files: Record<string, string>,
    private readonly during: (fs: MemoryFileSystem) => void,
  ) {
    super(files);
  }

  override async list(root: string, limit: number): Promise<VaultListing> {
    const listing = await super.list(root, limit);
    this.during(this);
    return listing;
  }
}

test("a file written while the first listing runs is indexed from its event", async () => {
  const fs = new ChangingDuringListing({ "A.md": "" }, (vault) =>
    vault.create("Late.md", "later"),
  );
  const indexer = new VaultIndexer(indexerOptions(fs));

  await indexer.settled();

  assert.ok(indexer.index.file("Late.md"), "Late.md is in the index");
  await indexer.dispose();
});

test("a file deleted while the first listing runs is not left in the index", async () => {
  const fs = new ChangingDuringListing({ "A.md": "", "Gone.md": "" }, (vault) =>
    vault.delete("Gone.md"),
  );
  const indexer = new VaultIndexer(indexerOptions(fs));

  await indexer.settled();

  assert.equal(indexer.index.file("Gone.md"), undefined);
  assert.ok(indexer.index.file("A.md"));
  await indexer.dispose();
});

test("an indexer disposed before its first listing starts no watch", async () => {
  const fs = new MemoryFileSystem({ "A.md": "" });
  const store = new GatedStore();
  let release!: () => void;
  store.gate = new Promise((resolve) => (release = resolve));
  const indexer = new VaultIndexer(indexerOptions(fs, { store }));

  await indexer.dispose();
  release();
  await indexer.settled();
  fs.create("Late.md", "later");

  assert.equal(indexer.index.file("Late.md"), undefined);
});

test("disposing before a gated store loads starts no watch, so none is left running", async () => {
  const fs = new CountingWatch({ "A.md": "" });
  const store = new GatedStore();
  let release!: () => void;
  store.gate = new Promise((resolve) => (release = resolve));
  const indexer = new VaultIndexer(indexerOptions(fs, { store }));

  await indexer.dispose();
  release();
  await indexer.settled();

  assert.equal(fs.starts, 0);
  assert.equal(fs.stops, 0);
});

test("disposing during the first listing stops the watch once", async () => {
  const fs = new CountingWatch({ "A.md": "" });
  // The listing starts while the constructor runs, so the override comes first.
  const owner: { indexer?: VaultIndexer } = {};
  const list = fs.list.bind(fs);
  fs.list = async (root: string, limit: number) => {
    const listing = await list(root, limit);
    void owner.indexer?.dispose();
    return listing;
  };
  owner.indexer = new VaultIndexer(indexerOptions(fs));
  const indexer = owner.indexer;

  await indexer.settled();

  assert.equal(fs.stops, 1);
});

test("a rejected listing stops the watch once and applies no event held meanwhile", async () => {
  const fs = new CountingWatch({ "A.md": "" });
  fs.list = async () => {
    fs.create("Late.md", "later");
    throw new Error("listing failed");
  };
  const indexer = new VaultIndexer(indexerOptions(fs));

  await indexer.settled();

  assert.equal(fs.stops, 1);
  assert.equal(indexer.index.file("Late.md"), undefined);
  await indexer.dispose();
  assert.equal(fs.stops, 1);
});
