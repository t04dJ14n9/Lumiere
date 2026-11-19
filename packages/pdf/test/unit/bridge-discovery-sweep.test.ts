import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { sweepDiscoveryFiles } from "../../src/extension/plugins/agentBridge/mcp/discovery-sweep";

test("discovery files of crashed windows are swept; live, unreadable and other files stay", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-bridges-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "1001.json"), JSON.stringify({ pid: 11 }));
  await writeFile(path.join(dir, "1002.json"), JSON.stringify({ pid: 22 }));
  await writeFile(path.join(dir, "1003.json"), "not json");
  await writeFile(path.join(dir, "notes.txt"), JSON.stringify({ pid: 11 }));
  await sweepDiscoveryFiles(dir, (pid) => pid === 11);
  assert.deepEqual((await readdir(dir)).sort(), [
    "1002.json",
    "1003.json",
    "notes.txt",
  ]);
});

test("a missing folder is nothing to sweep", async () => {
  await sweepDiscoveryFiles(path.join(tmpdir(), "lumiere-no-such-folder-x"));
});

test("this process is not gone", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-bridges-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    path.join(dir, "1.json"),
    JSON.stringify({ pid: process.pid }),
  );
  await sweepDiscoveryFiles(dir);
  assert.deepEqual(await readdir(dir), ["1.json"]);
});
