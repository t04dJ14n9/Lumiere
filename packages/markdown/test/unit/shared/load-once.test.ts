import test from "node:test";
import assert from "node:assert/strict";
import { loadOnceUnlessFailed } from "../../../src/shared/load-once";

test("a load runs once and its result is shared", async () => {
  let runs = 0;
  const load = loadOnceUnlessFailed(async () => ++runs);
  assert.deepEqual(await Promise.all([load(), load()]), [1, 1]);
  assert.equal(await load(), 1);
  assert.equal(runs, 1);
});

test("a failed load is tried again by the next caller", async () => {
  let runs = 0;
  const load = loadOnceUnlessFailed(async () => {
    runs += 1;
    if (runs === 1) {
      throw new Error("chunk did not arrive");
    }
    return "loaded";
  });
  await assert.rejects(load(), /chunk did not arrive/);
  assert.equal(await load(), "loaded");
  assert.equal(await load(), "loaded");
  assert.equal(runs, 2);
});
