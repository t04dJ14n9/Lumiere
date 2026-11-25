import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tables.css"),
  "utf8",
);

test("table-scroll uses overflow-x auto", () => {
  const rule = css.match(/\.table-scroll\s*\{[^}]*\}/)?.[0];
  assert.ok(rule);
  assert.match(rule, /overflow-x\s*:\s*auto/);
});

test("a table fits the note's width and wraps, down to a readable measure", () => {
  const rule = css.match(/\.table-wrapper\s*\{[^}]*\}/)?.[0];
  assert.ok(rule);
  assert.match(rule, /width\s*:\s*fit-content/);
  // Only columns the browser sizes: dragged widths may go narrower.
  const readable = css.match(
    /table:not\(\.table-sized-columns\) \.table-cell-wrapper\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(readable);
  assert.match(
    readable,
    /min-width:\s*calc-size\(max-content, min\(size, 12em\)\)/,
  );
});
