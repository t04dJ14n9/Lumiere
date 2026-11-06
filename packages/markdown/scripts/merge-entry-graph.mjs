// Folds the editor entry and the shared chunks esbuild splits out of its
// static graph into the one file editor.js.
//
// esbuild has no manualChunks: it puts every module that a different set of
// lazy features share into a file of its own, so the entry's static graph came
// out as ~55 files (a median of about 1 KB). Each file is a request through
// VS Code's webview resource loader, which costs about 0.5 ms and queues
// behind the others. One file is fetched and linked faster than 55.
//
// Lazy chunks keep importing the shared code, now from editor.js, which
// re-exports every export of every folded chunk under a name made from the
// chunk's. Module identity is unchanged: each module still exists once.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";
import { outputOfEntry, staticGraph } from "./static-graph.mjs";

const ENTRY_POINT = "src/webview/main.ts";
// What esbuild writes for a chunk import, minified or not.
const CHUNK_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*"\.\/(chunk-[\w-]+\.js)"\s*;?|import\s*"\.\/(chunk-[\w-]+\.js)"\s*;?/g;

/** What editor.js exports a folded chunk's export `name` as. */
function exportName(chunk, name) {
  return `c_${chunk.replace(/^chunk-|\.js$/g, "")}_${name}`;
}

/** The `export {…} from` lines that make editor.js re-export each folded chunk. */
function reexports(chunks, outputs) {
  return chunks.flatMap((chunk) => {
    const names = outputs[chunk.key].exports;
    return names.length
      ? [
          `export{${names.map((name) => `${name} as ${exportName(chunk.file, name)}`)}}from"./${chunk.file}";`,
        ]
      : [];
  });
}

/** `import {a as b}` of a folded chunk becomes `import {c_X_a as b}` of editor.js. */
function redirectImports(source, folded, entryFile) {
  return source.replace(CHUNK_IMPORT, (statement, names, named, bare) => {
    if (bare) {
      return folded.has(bare) ? `import"./${entryFile}";` : statement;
    }
    if (!folded.has(named)) {
      return statement;
    }
    const redirected = names.split(",").map((part) => {
      const [name, local = name] = part.trim().split(/\s+as\s+/);
      return `${exportName(named, name)} as ${local}`;
    });
    return `import{${redirected}}from"./${entryFile}";`;
  });
}

/**
 * Rewrites the editor build's output in `directory`. `metafile` is the
 * build's, whose paths are relative to `workingDirectory`; `build` is the
 * esbuild options to bundle the entry again with (`minify`, `target`,
 * `sourcemap`). Returns how many chunks were folded.
 */
export async function mergeEntryGraph({
  metafile,
  workingDirectory,
  directory,
  build,
}) {
  const { outputs } = metafile;
  const file = (key) =>
    path.relative(directory, path.resolve(workingDirectory, key));
  const entryKey = outputOfEntry(metafile, ENTRY_POINT);
  const entryFile = file(entryKey);
  const chunks = [...staticGraph(metafile, entryKey)]
    .filter((key) => key !== entryKey)
    .map((key) => ({ key, file: file(key) }));
  const folded = new Set(chunks.map((chunk) => chunk.file));

  // The entry's own imports keep their order, so modules still evaluate as before.
  const merged = await esbuild.build({
    ...build,
    stdin: {
      contents: [`import"./${entryFile}";`, ...reexports(chunks, outputs)].join(
        "\n",
      ),
      resolveDir: directory,
    },
    outfile: path.join(directory, entryFile),
    bundle: true,
    format: "esm",
    write: false,
    logLevel: "warning",
    plugins: [
      {
        name: "keep-lazy-imports",
        setup(context) {
          context.onResolve({ filter: /^\.\// }, ({ path: specifier }) =>
            folded.has(specifier.slice(2)) || specifier === `./${entryFile}`
              ? undefined
              : { path: specifier, external: true },
          );
        },
      },
    ],
  });

  for (const key of Object.keys(outputs)) {
    const name = file(key);
    if (name.endsWith(".js") && !folded.has(name) && name !== entryFile) {
      const source = await readFile(path.join(directory, name), "utf8");
      const next = redirectImports(source, folded, entryFile);
      const leftover = [...folded].find((chunk) =>
        next.includes(`"./${chunk}"`),
      );
      if (leftover) {
        throw new Error(`${name} still imports ${leftover}, which was folded`);
      }
      if (next !== source) {
        await writeFile(path.join(directory, name), next);
      }
    }
  }
  for (const output of merged.outputFiles) {
    await writeFile(output.path, output.contents);
  }
  for (const chunk of folded) {
    await rm(path.join(directory, chunk), { force: true });
    await rm(path.join(directory, `${chunk}.map`), { force: true });
  }
  return folded.size;
}
