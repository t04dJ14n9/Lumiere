// Builds the bundle DeepSeek Harness installs, into dist/bundle/:
//   index.js           the host half (src/host), loaded by DSH as a plugin
//   client.js          the browser half (src/client), in DSH's module format
//   markdown/, page/shim.js, contributed.json   host-node's assets (see
//                      packages/host-node/scripts/assets.mjs)
//   package.json     generated from scripts/manifest.json (the DSH contract)
//   cordis.patch.yml, locale/, README.md   from bundle/
//   icon.png, LICENSE, notices
//
// Usage: node scripts/build.mjs [--production]
// Install into a DSH profile: dsh plugin --profile web add link:<dist/bundle>,
// or plugin_manager install_bundle with the absolute path to dist/bundle.
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";
import {
  buildHostAssets,
  nodeHostBuild,
} from "../../host-node/scripts/assets.mjs";

const production = process.argv.includes("--production");
const here = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const root = path.resolve(here, "../..");
const out = path.join(here, "dist", "bundle");

await rm(out, { recursive: true, force: true });
const { version, repository } = await buildHostAssets({ out, production });

await esbuild.build({
  ...nodeHostBuild,
  entryPoints: [path.join(here, "src/host/index.ts")],
  outfile: path.join(out, "index.js"),
  sourcemap: !production,
  minify: production,
});
await esbuild.build({
  entryPoints: [path.join(here, "src/client/index.ts")],
  outfile: path.join(out, "client.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: !production,
  minify: production,
  legalComments: "none",
  logLevel: "info",
});

// The bundle contract lives in a JSON template so a unit test can check it
// without running the (slow) build. Only the version and repository change
// from one build to the next.
const manifest = JSON.parse(
  await readFile(path.join(here, "scripts", "manifest.json"), "utf8"),
);
await writeFile(
  path.join(out, "package.json"),
  JSON.stringify({ ...manifest, version, repository }, null, 2) + "\n",
);
await cp(path.join(here, "bundle"), out, { recursive: true });
await cp(path.join(root, "media", "icon.png"), path.join(out, "icon.png"));
await cp(path.join(root, "LICENSE"), path.join(out, "LICENSE"));
const notices = await readFile(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  "utf8",
);
const ws = await readFile(
  path.join(root, "packages", "host-node", "node_modules", "ws", "LICENSE"),
  "utf8",
);
await writeFile(
  path.join(out, "THIRD_PARTY_NOTICES.md"),
  `${notices}\n## ws (bundled in index.js)\n\n\`\`\`\n${ws.trim()}\n\`\`\`\n`,
);
console.log(`Built ${path.relative(root, out)}`);
