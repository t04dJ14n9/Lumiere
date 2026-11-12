import path from "node:path";

const worktree = process.env.PR738_WORKTREE ?? "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-738";
const markdownDir = path.join(worktree, "packages/markdown");
const port = Number(process.env.PORT ?? "19238");
const url = `http://127.0.0.1:${port}`;

export default {
  testDir: path.join(markdownDir, "test/browser"),
  globalSetup: path.join(markdownDir, "test/browser/setup.ts"),
  testMatch: "mermaid-toolbar-overlap.spec.ts",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: "list",
  use: {
    headless: true,
    baseURL: url,
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: `${JSON.stringify(process.execPath)} /tmp/pr738-gui-evidence/serve-harness.mjs`,
    url: `${url}/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      HARNESS_ROOT: markdownDir,
    },
  },
};
