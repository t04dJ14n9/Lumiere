import test from "node:test";
import assert from "node:assert/strict";
import { reusableHash } from "../../../src/plugins/vault/snapshot";
import type { ListedFile } from "../../../src/plugins/vault/api";

const listed = (mtime: number, size: number): ListedFile => ({
  uri: "memory:///vault/A.md",
  path: "A.md",
  mtime,
  size,
});

test("a cached hash is reused while the file's time and size match", () => {
  assert.equal(
    reusableHash(listed(5, 9), { uri: "u", mtime: 5, size: 9, hash: "h" }),
    "h",
  );
  assert.equal(
    reusableHash(listed(6, 9), { uri: "u", mtime: 5, size: 9, hash: "h" }),
    undefined,
    "a newer time is read again",
  );
  assert.equal(
    reusableHash(listed(5, 10), { uri: "u", mtime: 5, size: 9, hash: "h" }),
    undefined,
    "a new size is read again",
  );
});

test("a seeded entry of 0 and 0 reuses its hash whatever the file's stats", () => {
  assert.equal(
    reusableHash(listed(42, 7), { uri: "u", mtime: 0, size: 0, hash: "h" }),
    "h",
  );
});

test("no hash, or no cached entry, reuses nothing", () => {
  assert.equal(
    reusableHash(listed(5, 9), { uri: "u", mtime: 5, size: 9 }),
    undefined,
  );
  assert.equal(reusableHash(listed(5, 9), undefined), undefined);
});
