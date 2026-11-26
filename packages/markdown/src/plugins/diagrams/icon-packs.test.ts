import assert from "node:assert/strict";
import test from "node:test";
import type { AsyncIconLoader } from "mermaid";
import { ICON_PACKS, registerIconPacks } from "./icon-packs";

test("icon packs register once per Mermaid instance", () => {
  const calls: string[][] = [];
  const mermaid = {
    registerIconPacks(loaders: AsyncIconLoader[]) {
      calls.push(loaders.map((loader) => loader.name));
    },
  };
  registerIconPacks(mermaid);
  registerIconPacks(mermaid);
  assert.deepEqual(calls, [
    ["fa", "fas", "far", "fab", "logos", "material-icon-theme"],
  ]);
});

test("each icon pack loads the icons its diagrams name", async () => {
  const expected: Record<string, string> = {
    fa: "car",
    fas: "wallet",
    far: "bell",
    fab: "github",
    logos: "react",
    "material-icon-theme": "typescript",
  };
  for (const pack of ICON_PACKS) {
    const icons = await pack.loader();
    const name = expected[pack.name];
    assert.ok(name, `no expectation for ${pack.name}`);
    assert.ok(icons.icons[name], `${pack.name}:${name} is missing`);
  }
});
