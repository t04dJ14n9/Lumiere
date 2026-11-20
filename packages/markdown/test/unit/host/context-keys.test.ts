import test from "node:test";
import assert from "node:assert/strict";
import { ContextKeys } from "../../../src/host/context-keys";

test("a context key is sent again only when its value changes", () => {
  const keys = new ContextKeys();
  assert.equal(keys.changes("lumiere.markdown.plugin.tags", true), true);
  assert.equal(keys.changes("lumiere.markdown.plugin.tags", true), false);
  assert.equal(keys.changes("lumiere.markdown.plugin.tags", false), true);
  assert.equal(keys.changes("lumiere.markdown.plugin.tags", false), false);
  assert.equal(keys.changes("lumiere.markdown.plugin.tags", undefined), true);
  assert.equal(keys.changes("lumiere.markdown.plugin.tags", undefined), false);
  // Each key on its own.
  assert.equal(keys.changes("lumiere.markdown.isMarp", undefined), true);
});

test("an object value and a failed set are always sent again", () => {
  const keys = new ContextKeys();
  const list = ["a"];
  assert.equal(keys.changes("lumiere.markdown.list", list), true);
  assert.equal(keys.changes("lumiere.markdown.list", list), true);
  keys.changes("lumiere.markdown.flag", true);
  keys.forget("lumiere.markdown.flag");
  assert.equal(keys.changes("lumiere.markdown.flag", true), true);
});
