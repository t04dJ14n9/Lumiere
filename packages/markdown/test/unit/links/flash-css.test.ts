import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const src = new URL("../../../src/", import.meta.url);
const linksCss = readFileSync(new URL("plugins/links/links.css", src), "utf8");

/** Every custom property a Lumiere stylesheet under `src` declares. */
function declaredProperties(): Set<string> {
  const names = new Set<string>();
  for (const path of readdirSync(src, { recursive: true })) {
    if (typeof path === "string" && path.endsWith(".css")) {
      const css = readFileSync(new URL(path, src), "utf8");
      for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/g)) {
        names.add(name!);
      }
    }
  }
  return names;
}

test("the link-target flash paints a background Lumiere defines", () => {
  const start = linksCss.indexOf(".cm-editor .is-flashing {");
  assert.ok(start >= 0, "the flash is styled");
  const block = linksCss.slice(start, linksCss.indexOf("}", start));
  assert.match(block, /background-color:\s*var\(--highlight\)/);
  // A var() without a fallback that nothing defines makes the declaration
  // invalid: the flash had no background (Obsidian's --text-highlight-bg).
  const declared = declaredProperties();
  for (const [, name] of linksCss.matchAll(/var\((--[\w-]+)\s*\)/g)) {
    assert.ok(declared.has(name!), `${name} is defined`);
  }
});
