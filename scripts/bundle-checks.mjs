// Checks on the built extension (scripts/build.mjs), apart so tests can run
// them on samples of both builds: `pnpm build` writes readable code and
// `pnpm package` minified code, and a check must hold for both.

/**
 * Whether Follow Link still creates notes from basename Markdown links
 * (`create: request.wiki || …`), which a wrong `@workshop/markdown`
 * resolution or a stale worktree drops.
 * @param {string} extensionJs
 */
export function keepsBasenameCreate(extensionJs) {
  return /create:\s*[\w$]+\.wiki\s*\|\|/.test(extensionJs);
}

/**
 * Rows of the bundle size report (scripts/bundle-size.mjs) whose growth over
 * the tolerance fails the package job: what every note pays for when it opens
 * (the webview entry) and every window at activation (the extension host).
 * The other rows only warn, since a deliberate feature may add a lazy chunk.
 */
export const gatedBundleRows = ["webview entry (editor.js)", "extension host"];

/**
 * Rows that grew by more than `tolerance` (0.1 is 10%) over the baseline,
 * split into failures (`gatedBundleRows`) and warnings. Counts, and rows
 * without a baseline, are reported but never judged.
 * @param {Record<string, number>} current
 * @param {Record<string, number>} baseline
 * @param {number} tolerance
 */
export function bundleGrowth(current, baseline, tolerance) {
  const failures = [];
  const warnings = [];
  for (const [name, now] of Object.entries(current)) {
    const before = baseline[name];
    if (name.endsWith("(count)") || !before) {
      continue;
    }
    if (now > before * (1 + tolerance)) {
      const row = { name, before, now };
      (gatedBundleRows.includes(name) ? failures : warnings).push(row);
    }
  }
  return { failures, warnings };
}
