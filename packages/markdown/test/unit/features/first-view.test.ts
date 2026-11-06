import test from "node:test";
import assert from "node:assert/strict";
import { features } from "../../../src/plugins/catalog";
import {
  CHROME_FEATURE_IDS,
  PAINT_FEATURE_IDS,
  firstViewFiles,
} from "../../../src/shared/first-view";

const chunks = {
  tables: ["webview/tables.js", "webview/shared.js"],
  properties: ["webview/properties.js", "webview/shared.js"],
  lineNumbers: ["webview/line-numbers.js"],
  outline: ["webview/outline.js"],
  vim: ["webview/vim.js"],
};

test("the first view lists chrome chunks before paint chunks, each file once", () => {
  assert.deepEqual(
    firstViewFiles(chunks, (id) => id !== "vim"),
    [
      "webview/properties.js",
      "webview/shared.js",
      "webview/line-numbers.js",
      "webview/tables.js",
    ],
  );
});

test("the first view skips features that are off and features after first paint", () => {
  assert.deepEqual(
    firstViewFiles(chunks, (id) => id === "tables" || id === "outline"),
    ["webview/tables.js", "webview/shared.js"],
  );
  assert.deepEqual(
    firstViewFiles(chunks, () => false),
    [],
  );
});

test("every first-view feature id names a feature with a webview half", () => {
  const webview = new Set(
    features
      .filter((manifest) => manifest.surfaces.includes("webview"))
      .map((manifest) => manifest.id),
  );
  for (const id of [...CHROME_FEATURE_IDS, ...PAINT_FEATURE_IDS]) {
    assert.ok(webview.has(id), `${id} is not a webview feature`);
  }
});
