import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { metadata } from "../../../src/markdown/metadata";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import { ParseQueue } from "../../../src/plugins/vault/parse-queue";
import { Snapshot } from "../../../src/plugins/vault/snapshot";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("unsaved text is indexed but its metadata is not kept in the snapshot", async () => {
  const index = new MemoryVaultIndex({
    root: "memory:///vault",
    folderNote: "",
    linkFormat: "shortest",
  });
  index.addFiles([
    { uri: "memory:///vault/A.md", path: "A.md", mtime: 1, size: 5 },
    { uri: "memory:///vault/B.md", path: "B.md", mtime: 1, size: 0 },
  ]);
  const snapshot = new Snapshot();
  let parses = 0;
  const queue = new ParseQueue({
    index,
    snapshot,
    fs: { read: async () => new TextEncoder().encode("[[B]]") },
    parse: async (text) => {
      parses++;
      return metadata(text);
    },
    hash,
    onSnapshotChanged: () => {},
    onDrained: () => {},
    onError: assert.fail,
  });
  queue.enqueue("A.md");
  await queue.drained();
  assert.deepEqual(Object.keys(snapshot.metadata), [hash("[[B]]")]);
  await snapshot.save({ read: async () => undefined, write: async () => {} });

  // Typing: each pause indexes the note's unsaved text.
  for (const text of ["[[B]] a", "[[B]] ab", "[[B]] abc"]) {
    queue.setOverlay("A.md", text);
    await queue.drained();
  }
  assert.equal(index.metadata("A.md")?.links.length, 1);
  assert.deepEqual(
    Object.keys(snapshot.metadata),
    [hash("[[B]]")],
    "no typing state stays in memory",
  );
  assert.equal(snapshot.isDirty, false, "nor makes a shard to write");

  // Unsaved text equal to what is known reuses it.
  const before = parses;
  queue.setOverlay("A.md", "[[B]]");
  await queue.drained();
  assert.equal(parses, before);
});
