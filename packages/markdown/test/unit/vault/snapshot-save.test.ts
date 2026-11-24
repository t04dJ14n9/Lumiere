import test from "node:test";
import assert from "node:assert/strict";
import { Snapshot } from "../../../src/plugins/vault/snapshot";
import { MemoryStore } from "./memory-fs";

/** A store whose writes reject while `failing` is set, as a full disk does. */
class FailingStore extends MemoryStore {
  failing = true;
  override async write(name: string, text: string): Promise<void> {
    if (this.failing) {
      throw new Error("disk full");
    }
    await super.write(name, text);
  }
}

test("a failed save keeps what it could not write dirty, so the next save writes it", async () => {
  const snapshot = new Snapshot();
  snapshot.setFile("A.md", { uri: "memory:///vault/A.md", mtime: 1, size: 1 });
  const store = new FailingStore();

  await assert.rejects(snapshot.save(store), /disk full/);
  assert.equal(snapshot.isDirty, true, "the failed write is still pending");

  store.failing = false;
  await snapshot.save(store);
  assert.equal(snapshot.isDirty, false);
  const reloaded = new Snapshot();
  await reloaded.load(store);
  assert.deepEqual(Object.keys(reloaded.files), ["A.md"]);
});
