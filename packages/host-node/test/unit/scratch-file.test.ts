import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodePlatform } from "../../src/host/node-platform";

test("a passage handed to an agent keeps its file when a later one has the same name", async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), "host-node-scratch-"));
  t.after(() => rm(data, { recursive: true, force: true }));
  const platform = createNodePlatform({ data, workers: "" });
  const first = await platform.writeScratchFile("README.md-1-5.md", "one");
  const second = await platform.writeScratchFile("README.md-1-5.md", "two");
  assert.notEqual(first, second);
  assert.equal(path.basename(fileURLToPath(first)), "README.md-1-5.md");
  assert.equal(await readFile(fileURLToPath(first), "utf8"), "one");
  assert.equal(await readFile(fileURLToPath(second), "utf8"), "two");
});
