// Unit tests of every package, each run from its own directory: the core,
// the agent formats, then Lumiere, Lumiere PDF and ink.
// Root scripts are tested too.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const concurrency = process.env.WORKSHOP_TEST_CONCURRENCY;
const options = concurrency ? [`--test-concurrency=${concurrency}`] : [];

function run(cwd, command, args) {
  // On Windows pnpm is a .cmd, which Node starts only through a shell.
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

function testFiles(...roots) {
  return roots.flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".test.ts"))
      .map((file) => `${root}/${file}`.replaceAll("\\", "/")),
  );
}

const failures = [
  run(".", "pnpm", [
    "exec",
    "tsx",
    "--test",
    ...options,
    ...testFiles("packages/core/test", "test/unit"),
  ]),
  run("packages/agents", "pnpm", [
    "exec",
    "tsx",
    "--test",
    ...options,
    // From the package's directory, where its fixtures are.
    ...testFiles("packages/agents/test").map((file) =>
      file.replace("packages/agents/", ""),
    ),
  ]),
  run("packages/markdown", "node", ["scripts/test.mjs"]),
  run("packages/pdf", "pnpm", ["test"]),
  run("packages/ink", "pnpm", ["test"]),
].filter((status) => status !== 0);
process.exit(failures.length ? 1 : 0);
