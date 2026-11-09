// Builds Lumia PDF's assets into this package's dist/ (the repository root
// bundles the extension host and copies this dist/ into dist/pdf/):
//   dist/agent-bridge-server.js  the agent bridge's MCP server, loaded by the
//                                host only when the bridge starts (it carries
//                                the MCP SDK and zod, which the host never
//                                loads otherwise)
//   dist/bridge-stdio.js         the stdio shim MCP clients run (see Copy MCP
//                                Setup)
//   dist/outline-engine.js       the extension host's PDFium for reading
//                                bookmarks (note suggestions); loaded on first
//                                use, with the viewer's embedpdf.wasm
//   dist/webview/viewer.js       the PDF viewer page (browser), plus viewer.css
//   dist/webview/embedpdf.wasm   the PDF engine, loaded by the viewer at
//                                runtime
//
// Usage: node scripts/build.mjs [--watch] [--production]
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";
import { embedPdfStubs } from "../../../scripts/embedpdf-stubs.mjs";
import { copyEngine, viewerBuild } from "./viewer.mjs";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const dist = path.join(root, "dist");

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  metafile: true,
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const bridgeServerEntry = path.join(
  root,
  "src/extension/plugins/agentBridge/mcp/server.ts",
);

const bridgeServer = {
  ...shared,
  entryPoints: [bridgeServerEntry],
  outfile: path.join(dist, "agent-bridge-server.js"),
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
};

const bridgeStdio = {
  ...shared,
  entryPoints: [path.join(root, "src/bridge-stdio/main.ts")],
  outfile: path.join(dist, "bridge-stdio.js"),
  platform: "node",
  format: "cjs",
  target: "node20",
};

const outlineEngine = {
  ...shared,
  entryPoints: [path.join(root, "src/extension/outlines/engine.ts")],
  outfile: path.join(dist, "outline-engine.js"),
  platform: "node",
  format: "cjs",
  target: "node20",
  // The runtime's loaders read `import.meta.url`, which a CommonJS bundle lacks.
  define: { "import.meta.url": "__importMetaUrl" },
  banner: {
    js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  // `createLocalEngine` uses none of the pieces the stubs replace, but esbuild
  // still lists their packages as inputs, which the repository's third-party
  // notices read: the fallback fonts, with their own licenses, stay out.
  plugins: [embedPdfStubs({ workerSource: true })],
};

const webview = viewerBuild({
  out: path.join(dist, "webview"),
  production,
});

await rm(dist, { recursive: true, force: true });
await copyEngine(path.join(dist, "webview"));
if (watch) {
  const contexts = await Promise.all(
    [bridgeServer, bridgeStdio, outlineEngine, webview].map((options) =>
      esbuild.context(options),
    ),
  );
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  const results = await Promise.all(
    [bridgeServer, bridgeStdio, outlineEngine, webview].map((options) =>
      esbuild.build(options),
    ),
  );
  // Every bundled source file; the repository's third-party notices read it.
  const inputs = new Set(
    results.flatMap((result) => Object.keys(result.metafile.inputs)),
  );
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  await writeFile(
    path.join(root, "artifacts/bundle-inputs.json"),
    JSON.stringify([...inputs].sort(), null, 1),
  );
}
