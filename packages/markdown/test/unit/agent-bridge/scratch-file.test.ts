import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as AgentsService from "../../../src/host/services/agents";
import { forgetModules } from "../../support/module-cache";

// The VS Code agent host's scratch file: the passage Copy Link for Agent
// attaches in Codex. Each VS Code window runs its own extension host, and
// every one of them writes into the same folder of this user's.

function loadAgents(): typeof AgentsService {
  const vscode = {
    env: { appName: "Visual Studio Code" },
    Uri: { file: (file: string) => pathToFileURL(file) },
  };
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  forgetModules(require, "/src/host/", "/src/shared/");
  try {
    return require("../../../src/host/services/agents.ts") as typeof AgentsService;
  } finally {
    loader._load = originalLoad;
  }
}

test("a passage copied in one window keeps its file when another window copies one with the same name", async (t) => {
  // The system temp folder of this test only: os.tmpdir() reads TMPDIR.
  const temp = await mkdtemp(path.join(tmpdir(), "lumiere-scratch-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = temp;
  t.after(async () => {
    process.env.TMPDIR = previous;
    await rm(temp, { recursive: true, force: true });
  });
  const windowOne = loadAgents().createAgentHost();
  const windowTwo = loadAgents().createAgentHost();
  // Lines 1 to 5 of README.md, in two projects.
  const first = await windowOne.writeScratchFile("README.md-1-5.md", "one");
  const second = await windowTwo.writeScratchFile("README.md-1-5.md", "two");
  assert.notEqual(first, second);
  assert.equal(path.basename(fileURLToPath(first)), "README.md-1-5.md");
  assert.equal(await readFile(fileURLToPath(first), "utf8"), "one");
  assert.equal(await readFile(fileURLToPath(second), "utf8"), "two");
});
