import test from "node:test";
import assert from "node:assert/strict";
import { byteRange } from "../../src/host/static";

test("a byte range names the exact slice of the file", () => {
  assert.deepEqual(byteRange("bytes=0-2", 10), { start: 0, end: 2 });
  assert.deepEqual(byteRange("bytes=4-", 10), { start: 4, end: 9 });
  assert.deepEqual(byteRange("bytes=4-100", 10), { start: 4, end: 9 });
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9 });
});

test("an unsatisfiable or malformed range is refused", () => {
  for (const header of [
    "bytes=10-",
    "bytes=9-2",
    "bytes=-0",
    "bytes=-",
    "bytes=abc-2",
    "items=0-2",
    "bytes=0-2, 4-6",
  ]) {
    assert.equal(byteRange(header, 10), undefined, header);
  }
  assert.equal(byteRange("bytes=0-2", 0), undefined);
});
