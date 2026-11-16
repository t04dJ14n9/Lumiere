import assert from "node:assert/strict";
import { test } from "node:test";
import { ViewerLoads } from "../../src/host/viewer/loads";

test("a load is current only once its bytes are sent", () => {
  const loads = new ViewerLoads();
  loads.begin();
  const load = loads.next();
  assert.equal(loads.isCurrent(load), false);
  loads.finished();
  assert.equal(loads.isCurrent(load), true);
  assert.equal(loads.isCurrent(load - 1), false);
});

test("a failed read keeps the viewer on its load; a superseded one waits for the newer", () => {
  const loads = new ViewerLoads();
  // Nothing was ever sent: there is no load to go on with.
  loads.begin();
  assert.equal(loads.abandon(), false);
  loads.begin();
  loads.next();
  loads.finished();
  const older = loads.begin();
  const newer = loads.begin();
  assert.equal(loads.isNewest(older), false);
  assert.equal(loads.abandon(), false);
  assert.equal(loads.isCurrent(1), false);
  assert.equal(loads.isNewest(newer), true);
  assert.equal(loads.abandon(), true);
  assert.equal(loads.isCurrent(1), true);
});

test("store saves about the shown load are taken until a reload reads the store", async () => {
  const loads = new ViewerLoads();
  loads.begin();
  loads.next();
  loads.finished();
  loads.begin();
  assert.equal(loads.isCurrent(1), false);
  assert.equal(loads.acceptsStoreSave(1), true);
  await loads.readStore(async () => {
    assert.equal(loads.acceptsStoreSave(1), false);
  });
  // A store read that fails ends too.
  await assert.rejects(loads.readStore(() => Promise.reject(new Error("EIO"))));
  assert.equal(loads.acceptsStoreSave(1), true);
  loads.next();
  assert.equal(loads.acceptsStoreSave(1), false);
  assert.equal(loads.acceptsStoreSave(2), true);
});

test("a failed newer read does not end the loading while an older load that read is on its way", () => {
  const loads = new ViewerLoads();
  loads.begin();
  loads.next();
  loads.finished();
  loads.begin(); // read the new bytes; now reading their annotation store
  loads.begin();
  assert.equal(loads.abandon(), false);
  assert.equal(loads.isCurrent(1), false, "the file is the older load's now");
  const delivered = loads.next();
  loads.finished();
  assert.equal(loads.isCurrent(delivered), true);
});

test("an older load sent while a newer one reads does not end the loading", () => {
  const loads = new ViewerLoads();
  loads.begin();
  loads.begin();
  const older = loads.next();
  loads.finished();
  assert.equal(loads.isCurrent(older), false, "newer bytes are on their way");
  const newer = loads.next();
  loads.finished();
  assert.equal(loads.isCurrent(newer), true);
});

test("the newest load failing first, then the superseded one ending, goes on with the shown load", () => {
  const loads = new ViewerLoads();
  loads.begin();
  loads.next();
  loads.finished();
  loads.begin(); // superseded: its read ends after the newer one's
  loads.begin(); // fails first
  assert.equal(loads.abandon(), false);
  assert.equal(loads.abandon(), true);
  assert.equal(loads.isCurrent(1), true);
});
