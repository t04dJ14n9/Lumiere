// An esbuild plugin for the bundles that contain EmbedPDF's engine
// (@embedpdf/engine): the PDF viewer, the Markdown editor's PDF embeds and
// the extension host's outline engine.
//
// `localEngine()` is written for bundlers that split code: it reaches the
// pieces it may need with dynamic imports, each its own lazy chunk. A bundle
// without splitting (the viewer is one IIFE script) inlines every one, and
// the editor's lazy chunks are counted by scripts/bundle-size.mjs. These
// pieces are never used here, because Lumiere hands the engine its wasm bytes
// and its fonts itself, so they are replaced by stubs.
//
// Used by packages/pdf/scripts/{viewer,build}.mjs and
// packages/markdown/scripts/build.mjs.

/**
 * @typedef {object} EmbedPdfStubOptions
 * @property {boolean} [workerSource] Stub the engine's worker, a 1.6 MB
 *   string that `worker: "inline"` turns into a blob worker. Only a bundle
 *   that runs the engine in its own thread (`createLocalEngine`), or hands
 *   `localEngine` a worker of its own, can do without it.
 * @property {boolean} [inlineTransport] Stub the engine's in-thread
 *   transport (`#inline-transport`, 1.6 MB, which `createLocalEngine` always
 *   starts and `localEngine` where there is no worker). Only a bundle that
 *   starts neither can do without it: the viewer runs its own host in the
 *   page's thread.
 */

/**
 * @param {EmbedPdfStubOptions} [options]
 * @returns {import('esbuild').Plugin}
 */
export function embedPdfStubs({
  workerSource = false,
  inlineTransport = false,
} = {}) {
  /** @type {Array<{ filter: RegExp, contents: string }>} */
  const stubs = [
    {
      // The Hebrew and Arabic fallback fonts, about 430 KB as base64. The
      // viewer passes `defaultFallbackFonts: false` and `createLocalEngine`
      // never loads fonts, so the list stays empty.
      filter: /^@embedpdf\/default-fallback-fonts\/library$/,
      contents:
        "export const DEFAULT_FALLBACK_FONTS = [];" +
        "export async function loadFallbackFont() { throw new Error('Lumiere ships no default fallback fonts'); }",
    },
    {
      // `new URL("./lib/embedpdf.wasm", import.meta.url)`, which a bundler
      // for the web turns into an asset and esbuild's IIFE output cannot
      // evaluate. Lumiere serves embedpdf.wasm itself and gives the engine its
      // bytes or its URL; an empty string reads to the engine as "no sibling
      // file".
      filter: /^@embedpdf\/engine-runtime-wasm32\/wasm-url$/,
      contents: "export default '';",
    },
  ];
  if (workerSource) {
    stubs.push({
      // dist/embedpdf-worker.source-<hash>.js, which the engine's entry
      // chunk imports as a sibling file. A throw here reaches the caller as
      // the engine's "could not load the inline engine worker" error.
      filter: /(^|\/)embedpdf-worker\.source-[\w-]+\.js$/,
      contents:
        "throw new Error('This bundle runs the engine in its own thread and has no worker');",
    });
  }
  if (inlineTransport) {
    stubs.push({
      // The module `startInlineTransport` imports; calling it is the error.
      filter: /^#inline-transport$/,
      contents:
        "export function createInlineTransport() { throw new Error('This bundle runs the engine in its own transport'); }",
    });
  }
  return {
    name: "embedpdf-stubs",
    setup(build) {
      for (const { filter, contents } of stubs) {
        build.onResolve({ filter }, (args) => ({
          path: args.path,
          namespace: "embedpdf-stub",
          pluginData: { contents },
        }));
      }
      build.onLoad({ filter: /.*/, namespace: "embedpdf-stub" }, (args) => ({
        contents: args.pluginData.contents,
        loader: "js",
      }));
    },
  };
}
