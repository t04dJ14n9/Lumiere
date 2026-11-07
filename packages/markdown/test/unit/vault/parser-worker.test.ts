import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeWorkerLauncher } from "../../../src/host/node-workers";
import { createVaultParser } from "../../../src/host/vault-parser";
import { metadata } from "../../../src/markdown/metadata";
import type { WorkerLauncher } from "../../../src/shared/workers";

test("the vault parser parses in its worker as the host would", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-vault-worker-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({
    entryPoints: ["src/workers/vault.ts"],
    outfile: join(directory, "vault.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "silent",
  });
  const parser = createVaultParser(nodeWorkerLauncher(directory));
  t.after(() => parser.dispose());
  const text = "---\ntags: [a]\n---\n# Title\n\nSee [[Other#Part]] and #tag.\n";
  // The metadata crosses the worker boundary by structured clone.
  assert.deepEqual(await parser.parse(text), structuredClone(metadata(text)));
});

test("without a worker the vault parser parses in the host", async () => {
  const failing: WorkerLauncher = {
    start: () => {
      throw new Error("no worker build");
    },
  };
  const parser = createVaultParser(failing);
  const text = "# Only here\n[[Link]]\n";
  assert.deepEqual(await parser.parse(text), metadata(text));
  parser.dispose();
});

test("when the worker fails to load or exits during a parse, parsing falls back to the host", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mw-vault-missing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const parser = createVaultParser(nodeWorkerLauncher(directory));
  t.after(() => parser.dispose());
  const text = "# Heading\n[[Target]]\n";
  assert.deepEqual(await parser.parse(text), metadata(text));
  assert.deepEqual(
    await parser.parse("# Second\n#tag\n"),
    metadata("# Second\n#tag\n"),
  );
});

test("a parse the host cannot finish after the worker fails is rejected and the others still settle", async () => {
  let fail!: (error: Error) => void;
  const crashing: WorkerLauncher = {
    start: () => ({
      post() {},
      onMessage() {},
      onError(listener) {
        fail = listener;
      },
      onExit() {},
      unref() {},
      terminate: () => Promise.resolve(),
    }),
  };
  const parser = createVaultParser(crashing);
  // metadata() has no known string it throws on, so the first request is not
  // text at all.
  const broken = parser.parse(null as unknown as string);
  const first = "# First\n[[One]]\n";
  const second = "# Second\n#tag\n";
  const fine = [parser.parse(first), parser.parse(second)];
  fail(new Error("worker crashed"));
  await assert.rejects(broken, TypeError);
  assert.deepEqual(await Promise.all(fine), [
    metadata(first),
    metadata(second),
  ]);
  // The worker is gone, so later parses run in the host.
  assert.deepEqual(await parser.parse(first), metadata(first));
});
