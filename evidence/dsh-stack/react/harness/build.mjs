// Bundles the harness with esbuild 0.28.2 from the pr-737 worktree and records
// provenance (actual git HEAD, React/react-dom versions, bundle hashes).
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const WORKTREE = "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-737";
const ROOT = "/tmp/chain-evidence-final/react";
const REACT = `${WORKTREE}/node_modules/.pnpm/react@19.3.1/node_modules/react`;
const REACT_DOM = `${WORKTREE}/node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom`;

const require = createRequire(`${WORKTREE}/package.json`);
const esbuild = require("esbuild");

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  define: { "process.env.NODE_ENV": '"development"' },
  sourcemap: true,
  metafile: true,
  logLevel: "info",
};

const builds = [
  {
    name: "current",
    entry: `${ROOT}/harness/entry-current.ts`,
    outfile: `${ROOT}/bundle-current.js`,
  },
  {
    name: "prefix",
    entry: `${ROOT}/harness/entry-prefix.ts`,
    outfile: `${ROOT}/bundle-prefix.js`,
  },
];

const record = {};
for (const build of builds) {
  const result = await esbuild.build({
    ...common,
    entryPoints: [build.entry],
    outfile: build.outfile,
  });
  const bytes = readFileSync(build.outfile);
  record[build.name] = {
    entry: build.entry,
    outfile: build.outfile,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    inputs: Object.keys(result.metafile.inputs),
  };
}

const git = (args) =>
  execFileSync("git", args, { cwd: WORKTREE }).toString().trim();

const provenance = {
  generatedAt: new Date().toISOString(),
  worktree: WORKTREE,
  head: git(["rev-parse", "HEAD"]),
  headSubject: git(["log", "-1", "--format=%s"]),
  gitStatusPorcelain: git(["status", "--porcelain"]),
  prefixSourceCommit: git(["rev-parse", "c7016eb3^{commit}"]),
  node: process.version,
  esbuild: esbuild.version,
  react: {
    version: JSON.parse(readFileSync(`${REACT}/package.json`, "utf8"))
      .version,
    entry: `${REACT}/index.js`,
  },
  reactDom: {
    version: JSON.parse(readFileSync(`${REACT_DOM}/package.json`, "utf8"))
      .version,
    entry: `${REACT_DOM}/client.js`,
  },
  bundles: record,
};
writeFileSync(
  `${ROOT}/provenance-build.json`,
  `${JSON.stringify(provenance, null, 2)}\n`,
);
console.log(JSON.stringify(provenance, null, 2));
