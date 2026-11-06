import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readFirstViewPreload } from "../../../src/host/feature-chunks";

async function extension(chunks?: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), "feature-chunks-"));
  if (chunks) {
    const webview = path.join(root, "dist", "markdown", "webview");
    await mkdir(webview, { recursive: true });
    await writeFile(
      path.join(webview, "feature-chunks.json"),
      JSON.stringify(chunks),
    );
  }
  return { fsPath: root };
}

test("the page preloads its entry and the chunks of the first-view features that are on by default", async () => {
  const files = readFirstViewPreload(
    await extension({
      properties: ["webview/properties.js", "webview/yaml.js"],
      tables: ["webview/tables.js", "webview/yaml.js"],
      // Off by default, and not a first-view feature.
      vim: ["webview/vim.js"],
      gitBlame: ["webview/blame.js"],
    }),
  );
  assert.deepEqual(files, [
    "webview/editor.js",
    "webview/properties.js",
    "webview/yaml.js",
    "webview/tables.js",
  ]);
});

test("a build without a chunk list preloads nothing", async () => {
  assert.deepEqual(readFirstViewPreload(await extension()), []);
});
