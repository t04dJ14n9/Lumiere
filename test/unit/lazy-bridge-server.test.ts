import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const plugin = path.resolve("packages/pdf/scripts/lazy-bridge-server.mjs");
const mcp = "src/extension/plugins/agentBridge/mcp";

/**
 * A copy of the PDF package's layout under `checkout`: the plugin in
 * scripts/, and a controller that imports `./server` beside the MCP server.
 */
async function fakeCheckout(
  checkout: string,
  controller: string,
): Promise<string> {
  await mkdir(path.join(checkout, "scripts"), { recursive: true });
  await mkdir(path.join(checkout, mcp), { recursive: true });
  await copyFile(plugin, path.join(checkout, "scripts/lazy-bridge-server.mjs"));
  await writeFile(
    path.join(checkout, mcp, "server.ts"),
    'export const server = "BUNDLED SERVER";\n',
  );
  const entry = path.join(checkout, mcp, "controller.ts");
  await writeFile(entry, controller);
  return entry;
}

async function bundle(checkout: string, entry: string): Promise<string> {
  const { lazyBridgeServer } = (await import(
    pathToFileURL(path.join(checkout, "scripts/lazy-bridge-server.mjs")).href
  )) as {
    lazyBridgeServer(output: string): esbuild.Plugin;
  };
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    plugins: [lazyBridgeServer("./pdf/agent-bridge-server.js")],
  });
  return result.outputFiles[0]!.text;
}

test("the MCP server stays out of the host bundle in a checkout path with a space", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lazy bridge é "));
  try {
    const entry = await fakeCheckout(
      dir,
      'export const load = () => import("./server");\n',
    );
    const output = await bundle(dir, entry);
    assert.match(output, /\.\/pdf\/agent-bridge-server\.js/);
    assert.doesNotMatch(output, /BUNDLED SERVER/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a build that never imports the MCP server fails", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lazy-bridge-"));
  try {
    const entry = await fakeCheckout(dir, "export const load = 1;\n");
    await assert.rejects(bundle(dir, entry), /agent bridge's MCP server/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
