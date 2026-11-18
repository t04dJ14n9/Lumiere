import test from "node:test";
import assert from "node:assert/strict";
import { chromePreloadIds } from "../../../src/webview/features";

test("a note without frontmatter does not preload the Properties chunk", () => {
  assert.deepEqual(chromePreloadIds(false), ["lineNumbers"]);
});

test("a note with frontmatter still preloads the whole chrome set", () => {
  assert.deepEqual([...chromePreloadIds(true)].sort(), [
    "lineNumbers",
    "properties",
  ]);
});
