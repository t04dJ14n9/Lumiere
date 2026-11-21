import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import * as net from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";
import { sweepDiscoveryFiles } from "../../src/extension/plugins/agentBridge/mcp/discovery-sweep";

test("discovery files of crashed windows are swept; live, unreadable and other files stay", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-bridges-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "1001.json"), JSON.stringify({ pid: 11 }));
  await writeFile(path.join(dir, "1002.json"), JSON.stringify({ pid: 22 }));
  await writeFile(path.join(dir, "1003.json"), "not json");
  await writeFile(path.join(dir, "notes.txt"), JSON.stringify({ pid: 11 }));
  await sweepDiscoveryFiles(dir, { isGone: (pid) => pid === 11 });
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
  const open = await openPort(t);
  await writeFile(
    path.join(dir, `${open}.json`),
    JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${open}/mcp` }),
  );
  await sweepDiscoveryFiles(dir);
  assert.deepEqual(await readdir(dir), [`${open}.json`]);
});

test("a sweep removes the file it judged, not a record published under another name while its probe waited", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-bridges-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const port = await closedPort();
  const record = (pid: number) =>
    JSON.stringify({ pid, url: `http://127.0.0.1:${port}/mcp` });
  // The files of a crashed window, one named as an earlier version named
  // files (by port), one as bridges now name them.
  await writeFile(path.join(dir, `${port}.json`), record(11));
  await writeFile(path.join(dir, `${port}-12-aaaaaaaaaaaa.json`), record(12));
  // Every probe of the port is still waiting when another bridge, which
  // got the port after the probes were sent, publishes its record.
  let probes = 0;
  let allProbesSent!: () => void;
  const sent = new Promise<void>((resolve) => (allProbesSent = resolve));
  let answerProbes!: (refused: boolean) => void;
  const answer = new Promise<boolean>((resolve) => (answerProbes = resolve));
  const sweeping = sweepDiscoveryFiles(dir, {
    isGone: () => false,
    refuses: () => {
      if (++probes === 2) {
        allProbesSent();
      }
      return answer;
    },
  });
  await sent;
  await writeFile(path.join(dir, `${port}-13-bbbbbbbbbbbb.json`), record(13));
  answerProbes(true);
  await sweeping;
  assert.deepEqual(await readdir(dir), [`${port}-13-bbbbbbbbbbbb.json`]);
});

test("every other file naming the port the sweeping bridge listens on goes, whichever process it names", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-bridges-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Both ports answer: the bridges of the files are live, or the stale
  // file's port was taken again. Only the sweeping bridge's port can tell.
  const [held, other] = [await openPort(t), await openPort(t)];
  const record = (port: number) =>
    JSON.stringify({
      pid: process.pid,
      url: `http://127.0.0.1:${port}/mcp`,
    });
  await writeFile(path.join(dir, `${held}.json`), record(held));
  await writeFile(path.join(dir, `${held}-1-aaaaaaaaaaaa.json`), record(held));
  await writeFile(
    path.join(dir, `${other}-1-bbbbbbbbbbbb.json`),
    record(other),
  );
  await sweepDiscoveryFiles(dir, { heldPort: held });
  assert.deepEqual(await readdir(dir), [`${other}-1-bbbbbbbbbbbb.json`]);
});

/** A loopback port nothing listens on (just closed). */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A loopback port something listens on until the test ends. */
async function openPort(t: TestContext): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return (server.address() as net.AddressInfo).port;
}
