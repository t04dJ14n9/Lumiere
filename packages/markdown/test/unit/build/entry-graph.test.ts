import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

/** The build scripts are plain ESM without declarations. */
async function scripts() {
  const directory = new URL("../../../scripts/", import.meta.url);
  const load = (name: string) => import(new URL(name, directory).href);
  return {
    featureChunks: (await load("feature-chunks.mjs"))
      .featureChunks as (options: {
      metafile: esbuild.Metafile;
      workingDirectory: string;
      distDirectory: string;
    }) => Record<string, string[]>,
    mergeEntryGraph: (await load("merge-entry-graph.mjs"))
      .mergeEntryGraph as (options: {
      metafile: esbuild.Metafile;
      workingDirectory: string;
      directory: string;
      build: esbuild.BuildOptions;
    }) => Promise<number>,
  };
}

/**
 * An entry and two lazy features, with modules shared by every pair: esbuild
 * splits those into chunks the way it does for the editor.
 */
async function build() {
  const root = await mkdtemp(path.join(tmpdir(), "entry-graph-"));
  const files: Record<string, string> = {
    "src/shared/counter.ts":
      "let n = 0;\nexport function next() { return ++n; }\n",
    "src/shared/ab.ts": 'export const ab = "ab";\n',
    "src/shared/mb.ts": 'export const mb = "mb";\n',
    "src/plugins/a/webview.ts":
      'import { next } from "../../shared/counter";\nimport { ab } from "../../shared/ab";\nexport const name = `a:${ab}:${next()}`;\n',
    "src/plugins/b/webview.ts":
      'import { next } from "../../shared/counter";\nimport { mb } from "../../shared/mb";\nexport const name = `b:${mb}:${next()}`;\n',
    "src/webview/main.ts": [
      'import { next } from "../shared/counter";',
      'import { ab } from "../shared/ab";',
      'import { mb } from "../shared/mb";',
      "const trace = [`main:${ab}:${mb}:${next()}`];",
      "(globalThis as { done?: Promise<string[]> }).done = (async () => {",
      '  trace.push((await import("../plugins/a/webview")).name);',
      '  trace.push((await import("../plugins/b/webview")).name);',
      "  return trace;",
      "})();",
    ].join("\n"),
  };
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  const directory = path.join(root, "dist", "webview");
  const { metafile } = await esbuild.build({
    absWorkingDir: root,
    entryPoints: { editor: "src/webview/main.ts" },
    outdir: directory,
    bundle: true,
    splitting: true,
    format: "esm",
    target: "chrome120",
    metafile: true,
    logLevel: "silent",
  });
  return { root, directory, metafile };
}

const chunkFiles = async (directory: string) =>
  (await readdir(directory)).filter((file) => /^chunk-.*\.js$/.test(file));

test("each feature lists the files its import adds to the entry's static graph", async () => {
  const { root, metafile } = await build();
  const { featureChunks } = await scripts();
  const chunks = featureChunks({
    metafile,
    workingDirectory: root,
    distDirectory: path.join(root, "dist"),
  });
  assert.deepEqual(Object.keys(chunks).sort(), ["a", "b"]);
  for (const id of ["a", "b"]) {
    // The feature's own chunk, and no chunk the entry loads anyway.
    assert.equal(chunks[id]!.length, 1);
    assert.match(chunks[id]![0]!, /^webview\/webview-\w+\.js$/);
  }
});

test("the folded entry is one file and the features still share its modules", async () => {
  const { root, directory, metafile } = await build();
  const { mergeEntryGraph } = await scripts();
  assert.ok((await chunkFiles(directory)).length >= 3);
  const folded = await mergeEntryGraph({
    metafile,
    workingDirectory: root,
    directory,
    build: { minify: true, target: "chrome120" },
  });
  assert.ok(folded >= 3);
  assert.deepEqual(await chunkFiles(directory), []);
  await import(pathToFileURL(path.join(directory, "editor.js")).href);
  const trace = await (globalThis as unknown as { done: Promise<string[]> })
    .done;
  // One counter, not one per file: a duplicated module would restart at 1.
  assert.deepEqual(trace, ["main:ab:mb:1", "a:ab:2", "b:mb:3"]);
});
