import assert from "node:assert/strict";
import test from "node:test";
import { keepIn } from "../../src/idb-folder";
import { MemoryFileSystem } from "../../src/memory-fs";

/**
 * Enough of an IndexedDB database for one write: the test settles each
 * transaction by hand, the way IndexedDB does after its requests succeeded.
 */
function fakeDatabase() {
  const transactions: {
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    error: Error | null;
    keys: string[];
  }[] = [];
  const db = {
    transaction() {
      const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        keys: [] as string[],
        objectStore: () => ({
          put: (_value: unknown, key: string) => transaction.keys.push(key),
          delete: (key: string) => transaction.keys.push(key),
        }),
      };
      transactions.push(transaction);
      return transaction;
    },
  };
  return { db: db as unknown as IDBDatabase, transactions };
}

const text = (value: string) => new TextEncoder().encode(value);

test("an IndexedDB folder finishes a write only once its transaction has committed", async () => {
  const { db, transactions } = fakeDatabase();
  const folder = new MemoryFileSystem(new Map(), keepIn(db, "vault"));
  let done = false;
  const writing = folder
    .write("Note.md", text("kept"), "create")
    .then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(done, false);
  assert.deepEqual(transactions[0]?.keys, ["vault\u0000Note.md"]);
  transactions[0]?.oncomplete?.();
  await writing;
  assert.equal(done, true);
});

test("a write IndexedDB aborts fails, and the folder keeps what it had", async () => {
  const { db, transactions } = fakeDatabase();
  const folder = new MemoryFileSystem(new Map(), keepIn(db, "vault"));
  const first = folder.write("Note.md", text("one"), "create");
  await new Promise((resolve) => setTimeout(resolve, 0));
  transactions[0]?.oncomplete?.();
  await first;

  const second = folder.write("Note.md", text("two"), "replace");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const quota = transactions[1];
  assert.ok(quota);
  quota.error = Object.assign(new Error("Quota exceeded"), {
    name: "QuotaExceededError",
  });
  quota.onabort?.();
  await assert.rejects(second, /Quota exceeded/);
  assert.equal(new TextDecoder().decode(await folder.read("Note.md")), "one");
});

test("a memory folder undoes a change its persist refused, and a removal too", async () => {
  let refuse = false;
  const folder = new MemoryFileSystem({}, async () => {
    if (refuse) {
      throw new Error("Not kept");
    }
  });
  await folder.write("Kept.md", text("kept"), "create");
  refuse = true;
  await assert.rejects(
    folder.write("New.md", text("new"), "create"),
    /Not kept/,
  );
  assert.equal(await folder.stat("New.md"), undefined);
  await assert.rejects(folder.remove("Kept.md"), /Not kept/);
  assert.equal(new TextDecoder().decode(await folder.read("Kept.md")), "kept");
});
