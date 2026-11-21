import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as net from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import type { BridgeInfo } from "../../src/extension/plugins/agentBridge/mcp/constants";
import { announce } from "../../src/extension/plugins/agentBridge/mcp/discovery-file";
import { sweepDiscoveryFiles } from "../../src/extension/plugins/agentBridge/mcp/discovery-sweep";

/**
 * How a bridge publishes its discovery file next to the sweeps of other
 * windows. Each window is a process of its own, so what these tests run
 * one after another by hand (a sweep that has read a file and waits on a
 * probe, another window publishing meanwhile) really happens in any order.
 */

let dir: string;
let undo: (() => unknown)[];
const log = { info() {}, warn() {}, error() {} };

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "lumiere-bridges-"));
  undo = [];
});
afterEach(async () => {
  for (const step of undo.splice(0).reverse()) {
    await step();
  }
  vscode.forgetAll();
  await rm(dir, { recursive: true, force: true });
});

/** A loopback port something listens on, as a running bridge's does. */
async function listeningPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  undo.push(() => new Promise((resolve) => server.close(resolve)));
  return (server.address() as net.AddressInfo).port;
}

function bridgeInfo(port: number, token: string): BridgeInfo {
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    pid: process.pid,
    appName: "Visual Studio Code",
    workspaceFolders: ["/work/project"],
    startedAt: new Date().toISOString(),
  };
}

async function records(): Promise<BridgeInfo[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  return Promise.all(
    names
      .sort()
      .map(
        async (name) =>
          JSON.parse(
            await readFile(path.join(dir, name), "utf8"),
          ) as BridgeInfo,
      ),
  );
}

test("a sweep that found a port free cannot remove the record of the bridge that took the port meanwhile", async () => {
  // Bridge B listens on port P, which a crashed window's file still names
  // (its process id now belongs to another program, so only the port says
  // that file is stale).
  const port = await listeningPort();
  await writeFile(
    path.join(dir, `${port}.json`),
    JSON.stringify(bridgeInfo(port, "1".repeat(48))),
  );
  // Window A's sweep reads that file, and its probe of P comes back
  // "refused" only after B has published: the probe was sent before B
  // listened.
  let reachedProbe!: () => void;
  const probing = new Promise<void>((resolve) => (reachedProbe = resolve));
  let answerProbe!: (refused: boolean) => void;
  const answer = new Promise<boolean>((resolve) => (answerProbe = resolve));
  const sweeping = sweepDiscoveryFiles(dir, {
    isGone: () => false,
    refuses: () => {
      reachedProbe();
      return answer;
    },
  });
  await probing;
  const next = bridgeInfo(port, "2".repeat(48));
  await announce(next, { discoveryDir: dir, port, undo, log });
  answerProbe(true);
  await sweeping;
  assert.deepEqual(await records(), [next]);
});

test("a bridge that stops removes its own file and not another bridge's", async () => {
  const [firstPort, secondPort] = [
    await listeningPort(),
    await listeningPort(),
  ];
  const first = bridgeInfo(firstPort, "1".repeat(48));
  const second = bridgeInfo(secondPort, "2".repeat(48));
  const stopFirst: (() => unknown)[] = [];
  await announce(first, {
    discoveryDir: dir,
    port: firstPort,
    undo: stopFirst,
    log,
  });
  await announce(second, { discoveryDir: dir, port: secondPort, undo, log });
  assert.deepEqual((await records()).map((record) => record.token).sort(), [
    first.token,
    second.token,
  ]);
  for (const step of stopFirst.splice(0).reverse()) {
    await step();
  }
  assert.deepEqual(await records(), [second]);
});
