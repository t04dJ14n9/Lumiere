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
  assert.equal(loads.abandon(loads.begin()), false);
  loads.next();
  loads.finished();
  const older = loads.begin();
  const newer = loads.begin();
  assert.equal(loads.abandon(older), false);
  assert.equal(loads.isCurrent(1), false);
  assert.equal(loads.abandon(newer), true);
  assert.equal(loads.isCurrent(1), true);
});

test("store saves about the shown load are taken until a reload reads the store", () => {
  const loads = new ViewerLoads();
  loads.begin();
  loads.next();
  loads.finished();
  loads.begin();
  assert.equal(loads.isCurrent(1), false);
  assert.equal(loads.acceptsStoreSave(1), true);
  loads.readingStore();
  assert.equal(loads.acceptsStoreSave(1), false);
  loads.storeRead();
  loads.next();
  assert.equal(loads.acceptsStoreSave(1), false);
  assert.equal(loads.acceptsStoreSave(2), true);
});
