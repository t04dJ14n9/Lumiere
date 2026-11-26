import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLAPSED_NOTES_KEY,
  isPropertiesCollapsed,
} from "../../../src/shared/properties-collapse";
import { PropertyCollapseStore } from "../../../src/plugins/properties/collapse-store";

const storageOf = (value: unknown) => ({
  get: <T>(key: string, fallback: T) =>
    key === COLLAPSED_NOTES_KEY ? (value as T) : fallback,
});

test("a note is collapsed only when the workspace storage lists it", () => {
  const storage = storageOf({ "file:///a.md": true });
  assert.equal(isPropertiesCollapsed(storage, "file:///a.md"), true);
  assert.equal(isPropertiesCollapsed(storage, "file:///b.md"), false);
});

test("storage that holds anything else says no note is collapsed", () => {
  for (const value of [undefined, null, "x", 3, []]) {
    assert.equal(
      isPropertiesCollapsed(storageOf(value), "file:///a.md"),
      false,
    );
  }
});

test("what the store writes is what the editor reads for the snapshot and `ready`", async () => {
  let saved: unknown = {};
  const storage = {
    get: <T>(key: string, fallback: T) =>
      key === COLLAPSED_NOTES_KEY ? (saved as T) : fallback,
    update: async (key: string, value: unknown) => {
      assert.equal(key, COLLAPSED_NOTES_KEY);
      saved = value;
    },
  };
  const store = new PropertyCollapseStore(storage);
  await store.set("file:///a.md", true);
  assert.equal(isPropertiesCollapsed(storage, "file:///a.md"), true);
  assert.equal(store.read("file:///a.md"), true);
  await store.set("file:///a.md", false);
  assert.equal(isPropertiesCollapsed(storage, "file:///a.md"), false);
});
