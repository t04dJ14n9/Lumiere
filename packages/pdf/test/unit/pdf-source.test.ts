import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PdfSource } from "../../src/host/viewer/source";
import type { PdfFiles } from "../../src/shared/host";
import { RecentCache } from "../../src/shared/recent-cache";

/** A PDF whose bytes the test replaces, counting every whole-file read and hash. */
function file(initial: Uint8Array) {
  let bytes = initial;
  let fire = (): void => undefined;
  const counts = { reads: 0, hashes: 0 };
  const files: PdfFiles = {
    read: async () => {
      counts.reads++;
      return bytes;
    },
    hash: async () => {
      counts.hashes++;
      return createHash("sha256").update(bytes).digest("hex");
    },
    watch: (_uri, onChange) => {
      fire = onChange;
      return () => undefined;
    },
    displayPath: () => "paper.pdf",
  };
  return {
    files,
    counts,
    replace: (next: Uint8Array) => {
      bytes = next;
      fire();
    },
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 250));

test("a change on disk reads and hashes the file once, for the check and the reload", async () => {
  const pdf = file(new Uint8Array([1]));
  let changes = 0;
  const source = new PdfSource("file:///paper.pdf", pdf.files, {
    changed: () => changes++,
    failed: () => undefined,
  });
  await source.read();
  pdf.counts.reads = 0;
  pdf.replace(new Uint8Array([2]));
  await settled();
  assert.equal(changes, 1);
  const reloaded = await source.read();
  assert.deepEqual(new Uint8Array(reloaded!.data), new Uint8Array([2]));
  assert.deepEqual(pdf.counts, { reads: 1, hashes: 0 });
  // The next read is the file's again, not the bytes kept for that reload.
  await source.read();
  assert.equal(pdf.counts.reads, 2);
  source.dispose();
});

test("a change that leaves the bytes as they were reloads nothing", async () => {
  const pdf = file(new Uint8Array([1]));
  let changes = 0;
  const source = new PdfSource("file:///paper.pdf", pdf.files, {
    changed: () => changes++,
    failed: () => undefined,
  });
  await source.read();
  pdf.replace(new Uint8Array([1]));
  await settled();
  assert.equal(changes, 0);
  source.dispose();
});

test("a cache of recent pages keeps the most recently used, up to its limit", () => {
  const cache = new RecentCache<number, string>(2);
  cache.set(1, "one");
  cache.set(2, "two");
  assert.equal(cache.get(1), "one");
  cache.set(3, "three");
  assert.equal(cache.get(2), undefined, "the least recently used went");
  assert.equal(cache.get(1), "one");
  assert.equal(cache.size, 2);
  // A failed read drops only its own entry, not a newer one under the key.
  cache.delete(1, "stale");
  assert.equal(cache.get(1), "one");
  cache.delete(1, "one");
  assert.equal(cache.get(1), undefined);
});
