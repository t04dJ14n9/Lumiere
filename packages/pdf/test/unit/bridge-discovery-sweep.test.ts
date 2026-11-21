import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import * as net from "node:net";
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

test("a file whose process id now names another program goes once nothing listens on its port", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-bridges-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A window that crashed (or a reboot) left its file, and another
  // program now runs under its process id: by the id, it is alive.
  const closed = await closedPort();
  await writeFile(
    path.join(dir, `${closed}.json`),
    JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${closed}/mcp` }),
  );
  // A live bridge listens on its port.
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const open = (server.address() as net.AddressInfo).port;
  await writeFile(
    path.join(dir, `${open}.json`),
    JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${open}/mcp` }),
  );
  await sweepDiscoveryFiles(dir);
  assert.deepEqual(await readdir(dir), [`${open}.json`]);
});

/** A loopback port nothing listens on (just closed). */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
