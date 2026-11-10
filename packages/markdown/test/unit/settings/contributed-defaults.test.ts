import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { config as linksConfig } from "../../../src/plugins/links/manifest";
import { config as vaultConfig } from "../../../src/plugins/vault/manifest";

interface ContributedProperty {
  type?: string;
  default?: unknown;
  description?: string;
}

function contributed(): Map<string, ContributedProperty> {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../../../package.json", import.meta.url),
      "utf8",
    ),
  ) as {
    contributes?: {
      configuration?:
        | { properties?: Record<string, ContributedProperty> }
        | { properties?: Record<string, ContributedProperty> }[];
    };
  };
  const sections = manifest.contributes?.configuration;
  const list = Array.isArray(sections) ? sections : sections ? [sections] : [];
  return new Map(
    list.flatMap((section) => Object.entries(section.properties ?? {})),
  );
}

test("the two new Obsidian settings are declared with their shipped defaults", () => {
  assert.equal(linksConfig.parse({}).focusNewTab, true);
  assert.equal(vaultConfig.parse({}).showUnsupportedFiles, false);
});

test("the contributed settings match the manifest defaults and types", () => {
  const props = contributed();
  const focusNewTab = props.get("lumiere.markdown.links.focusNewTab");
  const showUnsupportedFiles = props.get(
    "lumiere.markdown.vault.showUnsupportedFiles",
  );
  assert.ok(focusNewTab, "links.focusNewTab is contributed");
  assert.equal(focusNewTab.type, "boolean");
  assert.equal(focusNewTab.default, true);
  assert.ok(showUnsupportedFiles, "vault.showUnsupportedFiles is contributed");
  assert.equal(showUnsupportedFiles.type, "boolean");
  assert.equal(showUnsupportedFiles.default, false);
});
