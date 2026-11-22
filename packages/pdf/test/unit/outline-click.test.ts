import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLICK_HOLD_MS,
  OutlineClickHold,
} from "../../src/shared/outline-click";
import { ScopedCache } from "../../src/shared/scoped-cache";

test("with no click, every reading position is followed", () => {
  const hold = new OutlineClickHold();
  assert.deepEqual(hold.step("0", 0), { kind: "follow" });
  assert.equal(hold.clickedId, undefined);
});

test("a click is selected at once, and the position it is on its way to is left alone for a second", () => {
  const hold = new OutlineClickHold();
  hold.click("0.1", 1000);
  assert.equal(hold.clickedId, "0.1");
  // The old place, reported before the jump landed, and then the new one.
  assert.deepEqual(hold.step("0", 1100), { kind: "wait", ms: 900 });
  assert.deepEqual(hold.step("0.1", 1500), { kind: "wait", ms: 500 });
  assert.equal(hold.clickedId, "0.1");
  assert.equal(CLICK_HOLD_MS, 1000);
});

test("after the hold the click still wins where the jump landed, whichever bookmark that is", () => {
  const hold = new OutlineClickHold();
  hold.click("1", 0);
  // The heading is near the end of the PDF, which cannot scroll to put it at
  // the top: the position stays in an earlier bookmark.
  assert.deepEqual(hold.step("0.1", 1000), { kind: "stay" });
  assert.deepEqual(hold.step("0.1", 1200), { kind: "stay" });
  assert.equal(hold.clickedId, "1");
});

test("a group heading that goes nowhere keeps the selection until the reader moves", () => {
  const hold = new OutlineClickHold();
  hold.click("0", 0);
  assert.deepEqual(hold.step("0.0", 1000), { kind: "stay" });
  assert.deepEqual(hold.step("0.0", 5000), { kind: "stay" });
  assert.equal(hold.clickedId, "0");
});

test("when the reader moves on from where the click landed, the click is over and the position is followed", () => {
  const hold = new OutlineClickHold();
  hold.click("0.1", 0);
  assert.deepEqual(hold.step("0.1", 1000), { kind: "stay" });
  assert.deepEqual(hold.step("1", 1400), { kind: "follow" });
  assert.equal(hold.clickedId, undefined);
  assert.deepEqual(hold.step("1", 1500), { kind: "follow" });
});

test("a landing before the first bookmark counts as a place, and leaving it ends the click", () => {
  const hold = new OutlineClickHold();
  hold.click("0", 0);
  assert.deepEqual(hold.step(undefined, 1000), { kind: "stay" });
  assert.deepEqual(hold.step(undefined, 1100), { kind: "stay" });
  assert.deepEqual(hold.step("0", 1200), { kind: "follow" });
});

test("a second click starts again, wherever the first landed", () => {
  const hold = new OutlineClickHold();
  hold.click("0.1", 0);
  assert.deepEqual(hold.step("0.1", 1000), { kind: "stay" });
  hold.click("1", 2000);
  assert.equal(hold.clickedId, "1");
  assert.deepEqual(hold.step("0.1", 2100), { kind: "wait", ms: 900 });
  assert.deepEqual(hold.step("1", 3000), { kind: "stay" });
});

test("a cache keeps what was set under its scope, and forgets it when the scope changes", () => {
  const cache = new ScopedCache<string>(10);
  cache.set(1, "a", "Old version's quote");
  assert.equal(cache.get(1, "a"), "Old version's quote");
  // A reload: the same key in a new document.
  assert.equal(cache.get(2, "a"), undefined);
  cache.set(2, "a", "New version's quote");
  assert.equal(cache.get(2, "a"), "New version's quote");
  // And the old scope's values are not coming back.
  assert.equal(cache.get(1, "a"), undefined);
});

test("a scoped cache keeps its limit", () => {
  const cache = new ScopedCache<number>(2);
  cache.set("x", "a", 1);
  cache.set("x", "b", 2);
  cache.set("x", "c", 3);
  assert.equal(cache.get("x", "a"), undefined);
  assert.equal(cache.get("x", "c"), 3);
});
