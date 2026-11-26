import test from "node:test";
import assert from "node:assert/strict";
import { followsReference } from "./adjacent";

test("a reference follows another only when the text before ends in one", () => {
  assert.equal(followsReference("Claim[^30]"), true);
  assert.equal(followsReference("Claim[^long-label_2]"), true);
  assert.equal(followsReference("Claim[^30] "), false);
  assert.equal(followsReference("Claim, see [link]"), false);
  assert.equal(followsReference("Claim^[inline]"), false);
  assert.equal(followsReference(""), false);
});
