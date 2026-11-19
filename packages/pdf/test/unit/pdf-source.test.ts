import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { MAX_PDF_BYTES, PdfSource } from "../../src/host/viewer/source";
import type { PdfFiles } from "../../src/shared/host";
import { RecentCache } from "../../src/shared/recent-cache";

/** A PDF whose bytes the test replaces, counting every whole-file read and hash. */
function file(initial: Uint8Array, overrides: Partial<PdfFiles> = {}) {
  let bytes = initial;
  const watchers = new Set<() => void>();
  const counts = { reads: 0, hashes: 0, watches: 0 };
  const files: PdfFiles = {
    read: async () => {
      counts.reads++;
      // A read takes a while: another editor's read starts meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return bytes;
    },
    hash: async () => {
      counts.hashes++;
      return createHash("sha256").update(bytes).digest("hex");
    },
    watch: (_uri, onChange) => {
      counts.watches++;
      const watcher = () => onChange();
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    displayPath: () => "paper.pdf",
    ...overrides,
  };
  return {
    files,
    counts,
    watching: () => watchers.size,
    replace: (next: Uint8Array) => {
      bytes = next;
      for (const watcher of watchers) {
        watcher();
      }
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
  assert.deepEqual(pdf.counts, { reads: 1, hashes: 0, watches: 1 });
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

/** `count` editors of one PDF, each counting the changes it is told of. */
function editors(pdf: ReturnType<typeof file>, count: number) {
  const changes: number[] = [];
  const failures: string[] = [];
  const sources = Array.from({ length: count }, (_, index) => {
    changes.push(0);
    return new PdfSource("file:///paper.pdf", pdf.files, {
      changed: () => {
        changes[index] = (changes[index] ?? 0) + 1;
      },
      failed: (message) => failures.push(message),
    });
  });
  return { sources, changes, failures };
}

test("two editors of one PDF watch it once, and stop when both close", () => {
  const pdf = file(new Uint8Array([1]));
  const { sources } = editors(pdf, 2);
  assert.equal(pdf.counts.watches, 1);
  sources[0]!.dispose();
  assert.equal(pdf.watching(), 1);
  sources[1]!.dispose();
  assert.equal(pdf.watching(), 0);
});

test("a change on disk is read and hashed once for every editor of the PDF", async () => {
  const pdf = file(new Uint8Array([1]));
  const { sources, changes } = editors(pdf, 3);
  await Promise.all(sources.map((source) => source.read()));
  pdf.counts.reads = 0;
  pdf.replace(new Uint8Array([2]));
  await settled();
  assert.deepEqual(changes, [1, 1, 1]);
  const reloaded = await Promise.all(sources.map((source) => source.read()));
  for (const bytes of reloaded) {
    assert.deepEqual(new Uint8Array(bytes!.data), new Uint8Array([2]));
  }
  assert.equal(pdf.counts.reads, 1);
  for (const source of sources) {
    source.dispose();
  }
});

test("editors that open the PDF at once share one read of it", async () => {
  const pdf = file(new Uint8Array([1]));
  const { sources } = editors(pdf, 2);
  const [one, two] = await Promise.all(sources.map((source) => source.read()));
  assert.equal(pdf.counts.reads, 1);
  assert.equal(one?.sha256, two?.sha256);
  // A read after those is the file's again.
  await sources[0]!.read();
  assert.equal(pdf.counts.reads, 2);
  for (const source of sources) {
    source.dispose();
  }
});

test("a PDF over the size limit is refused before it is read, and says why", async () => {
  const pdf = file(new Uint8Array([1]), {
    size: async () => MAX_PDF_BYTES + 1,
  });
  const { sources, failures } = editors(pdf, 1);
  assert.equal(await sources[0]!.read(), undefined);
  assert.equal(pdf.counts.reads, 0);
  assert.match(
    failures[0] ?? "",
    /paper\.pdf is larger than 512 MB, the most Lumiere PDF opens/u,
  );
  sources[0]!.dispose();
});

test("bytes over the size limit from a host that cannot tell the size first are refused too", async () => {
  // The limit is the host's: here it is 8 bytes.
  const pdf = file(new Uint8Array(16), { maxBytes: 8 });
  const { sources, failures } = editors(pdf, 1);
  assert.equal(await sources[0]!.read(), undefined);
  assert.match(failures[0] ?? "", /larger than 8 bytes/u);
  sources[0]!.dispose();
});
