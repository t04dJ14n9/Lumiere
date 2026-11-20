import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const tests = ["src", "test/unit"].flatMap((root) =>
  readdirSync(root, { recursive: true })
    .filter((p) => p.endsWith(".test.ts"))
    .map((p) => `${root}/${p}`.replaceAll("\\", "/")),
);
// Shared development hosts may need fewer workers to keep performance probes
// within their deadlines. The default remains Node's available-CPU policy.
const concurrency = process.env.MARKDOWN_WORKBENCH_TEST_CONCURRENCY;
const workerOptions = concurrency ? [`--test-concurrency=${concurrency}`] : [];
// tsx's CLI under this Node, not `pnpm exec tsx`: on Windows pnpm is a .cmd
// that needs a shell, and cmd.exe takes no more than 8191 characters, far
// fewer than the list of test files.
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const result = spawnSync(
  process.execPath,
  [tsx, "--test", ...workerOptions, ...tests],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
