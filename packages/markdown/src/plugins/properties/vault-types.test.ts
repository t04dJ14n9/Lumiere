import test from "node:test";
import assert from "node:assert/strict";
import type { ObsidianCompat, WirePropertyType } from "../obsidianCompat/api";
import { PropertyTypeStore } from "./type-store";
import { VaultPropertyTypes } from "./vault-types";

const ROOT = "file:///vault";

function memoryStore(): PropertyTypeStore {
  const saved = new Map<string, unknown>();
  return new PropertyTypeStore({
    get: <T>(key: string, fallback: T) => (saved.get(key) as T) ?? fallback,
    update: async (key, value) => {
      saved.set(key, value);
    },
  });
}

function fakeCompat(
  registry: Record<string, string>,
  options: { canWrite?: boolean } = {},
) {
  const writes: [string, WirePropertyType | null][] = [];
  const compat = {
    getPropertyTypes: async () => ({ ...registry }),
    setPropertyType: async (
      _scope: unknown,
      name: string,
      type: WirePropertyType | null,
    ) => {
      if (options.canWrite === false) {
        throw new Error("read-only");
      }
      writes.push([name, type]);
      if (type === null) {
        delete registry[name];
      } else {
        registry[name] = type;
      }
    },
  } as unknown as ObsidianCompat;
  return { compat, writes };
}

test("types.json drives the property types; multitext is a list", async () => {
  const { compat } = fakeCompat({
    Code: "text",
    tags: "tags",
    related: "multitext",
    due: "date",
    odd: "unknown-type",
  });
  const types = new VaultPropertyTypes(ROOT, memoryStore(), compat);
  // tags keeps its reserved type whatever the registry says.
  assert.deepEqual(await types.read(), {
    code: "text",
    related: "list",
    due: "date",
  });
});

test("a type chosen in Lumiere is written to types.json and read back from it", async () => {
  const local = memoryStore();
  await local.set(ROOT, "code", "number");
  const { compat, writes } = fakeCompat({ Code: "number", due: "date" });
  const types = new VaultPropertyTypes(ROOT, local, compat);
  assert.deepEqual(await types.set("code", "text"), {
    code: "text",
    due: "date",
  });
  assert.deepEqual(writes, [["Code", "text"]]);
  // The Lumiere-only choice no longer masks the registry.
  assert.deepEqual(local.read(ROOT), {});
  await types.set("links", "list");
  assert.deepEqual(writes.at(-1), ["links", "multitext"]);
});

test("without a registry, or when it cannot be written, Lumiere keeps the type", async () => {
  const empty = fakeCompat({});
  const types = new VaultPropertyTypes(ROOT, memoryStore(), empty.compat);
  assert.deepEqual(await types.set("due", "date"), { due: "date" });
  // No .obsidian/types.json is created in a folder Obsidian does not use.
  assert.deepEqual(empty.writes, []);

  const readOnly = fakeCompat({ due: "date" }, { canWrite: false });
  const fallback = new VaultPropertyTypes(ROOT, memoryStore(), readOnly.compat);
  assert.deepEqual(await fallback.set("code", "number"), {
    due: "date",
    code: "number",
  });
  const none = new VaultPropertyTypes(ROOT, memoryStore(), undefined);
  assert.deepEqual(await none.set("code", "number"), { code: "number" });
});
