import test from "node:test";
import assert from "node:assert/strict";
import { decodeBase64, encodeBase64 } from "../../../src/attachments";

test("base64 round-trips bytes of every length, a large file in chunks", () => {
  for (const length of [
    0,
    1,
    2,
    3,
    4,
    0x8000 - 1,
    0x8000,
    0x8000 + 1,
    100_003,
  ]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 31) % 256);
    const encoded = encodeBase64(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString("base64"), `${length}`);
    assert.deepEqual(decodeBase64(encoded), bytes, `${length}`);
  }
});
