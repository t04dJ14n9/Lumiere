// An esbuild plugin that gives the viewer its engine worker as a string:
// `import source from "lumiere:engine-worker"` is src/engine-worker/worker-entry.ts
// built as a worker script (an IIFE with PDFium's JavaScript glue and
// EmbedPDF's engine host inside, and no import left), the way EmbedPDF builds
// its own worker (@embedpdf/engine, scripts/build-workers.mjs). The viewer
// starts it as a blob worker. embedpdf.wasm stays a file: the worker gets its
// bytes from the page.
import path from "node:path";
import * as esbuild from "esbuild";
import { embedPdfStubs } from "../../../scripts/embedpdf-stubs.mjs";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const MODULE = "lumiere:engine-worker";

/**
 * @param {{ production: boolean }} options
 * @returns {import('esbuild').Plugin}
 */
export function engineWorkerSource({ production }) {
  return {
    name: "lumiere-engine-worker",
    setup(build) {
      /** What the worker's build read, as the viewer build's metafile lists it. */
      let inputs = {};
      build.onResolve({ filter: /^lumiere:engine-worker$/ }, () => ({
        path: MODULE,
        namespace: "lumiere-engine-worker",
      }));
      build.onLoad(
        { filter: /.*/, namespace: "lumiere-engine-worker" },
        async () => {
          const result = await esbuild.build({
            entryPoints: [path.join(root, "src/engine-worker/worker-entry.ts")],
            bundle: true,
            write: false,
            metafile: true,
            format: "iife",
            platform: "browser",
            target: "es2020",
            minify: production,
            legalComments: "none",
            logLevel: "warning",
            // The glue's `new URL("embedpdf.wasm", import.meta.url)` reads the
            // worker's own address, which is the same in a worker.
            define: { "import.meta.url": "self.location.href" },
            plugins: [embedPdfStubs()],
          });
          inputs = result.metafile.inputs;
          return {
            contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
            loader: "js",
            // A change to the worker's code rebuilds the viewer in watch mode.
            watchFiles: Object.keys(inputs).map((input) => path.resolve(input)),
          };
        },
      );
      // The worker's packages are part of what the viewer ships: the
      // repository's third-party notices read the build's inputs.
      build.onEnd((result) => {
        if (result.metafile) {
          Object.assign(result.metafile.inputs, inputs);
        }
      });
    },
  };
}
