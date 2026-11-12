// Playwright config for the PR #739 temporary pointer-evidence spec.
// No webServer section: the harness on 19239 is launched separately and its
// ownership is verified with lsof before any browser work.
export default {
  testDir: "/tmp/pr739-gui-evidence/spec",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["json", { outputFile: "/tmp/pr739-gui-evidence/playwright-report.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:19239",
    viewport: { width: 1000, height: 700 },
    trace: "retain-on-failure",
  },
};
