import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bundleGrowth,
  gatedBundleRows,
  keepsBasenameCreate,
} from "../../scripts/bundle-checks.mjs";

test("the basename create path is found in the readable build and the minified one", () => {
  // `pnpm build`, as `pnpm test:vscode` builds it.
  assert.ok(
    keepsBasenameCreate(
      "      create: request2.wiki || mayCreateNote(path13),",
    ),
  );
  // `pnpm package`.
  assert.ok(keepsBasenameCreate("{create:e.wiki||Wt(n)}"));
  assert.ok(keepsBasenameCreate("{create:$e.wiki||Wt(n)}"));
});

test("a build without it is caught", () => {
  assert.equal(keepsBasenameCreate("create: true, wiki: false"), false);
  assert.equal(keepsBasenameCreate(""), false);
});

test("growth of the entry or the extension host fails; of other rows it warns", () => {
  const grown = bundleGrowth(
    {
      "webview entry (editor.js)": 1101,
      "extension host": 1200,
      "webview lazy chunks (count)": 50,
      "webview lazy chunks (total)": 2000,
      "pdf viewer (JS, CSS, WASM)": 5000,
    },
    {
      "webview entry (editor.js)": 1000,
      "extension host": 1000,
      "webview lazy chunks (count)": 10,
      "webview lazy chunks (total)": 1000,
    },
    0.1,
  );
  assert.deepEqual(grown.failures, [
    { name: "webview entry (editor.js)", before: 1000, now: 1101 },
    { name: "extension host", before: 1000, now: 1200 },
  ]);
  // Counts, and rows with no baseline, are never judged.
  assert.deepEqual(
    grown.warnings.map((row) => row.name),
    ["webview lazy chunks (total)"],
  );
});

test("growth within the tolerance, and shrinking, pass", () => {
  const grown = bundleGrowth(
    { "webview entry (editor.js)": 1100, "extension host": 500 },
    { "webview entry (editor.js)": 1000, "extension host": 1000 },
    0.1,
  );
  assert.deepEqual(grown, { failures: [], warnings: [] });
});

test("the baseline has every gated row and the PDF rows the report measures", () => {
  const report = readFileSync("scripts/bundle-size.mjs", "utf8");
  const baseline = JSON.parse(
    readFileSync("scripts/bundle-baseline.json", "utf8"),
  ) as Record<string, number>;
  const rows = [
    ...gatedBundleRows,
    "pdf viewer (JS, CSS, WASM)",
    "pdf agent bridge",
  ];
  for (const name of rows) {
    assert.ok(report.includes(JSON.stringify(name)), name);
    assert.equal(typeof baseline[name], "number", name);
  }
});
