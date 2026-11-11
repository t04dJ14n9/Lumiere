import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contributions } from "../../../scripts/contributions";
import {
  config as linksConfig,
  reservedConfig as linksReserved,
} from "../../../src/plugins/links/manifest";
import {
  config as vaultConfig,
  reservedConfig as vaultReserved,
} from "../../../src/plugins/vault/manifest";

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

test("the two reserved Obsidian settings are declared with their schema defaults", () => {
  assert.equal(linksReserved.parse({}).focusNewTab, true);
  assert.equal(vaultReserved.parse({}).showUnsupportedFiles, false);
  assert.equal("focusNewTab" in linksConfig.parse({}), false);
  assert.equal("showUnsupportedFiles" in vaultConfig.parse({}), false);
});

test("the unread settings are not contributed as Settings toggles", () => {
  const props = contributed();
  assert.equal(
    props.has("lumiere.markdown.links.focusNewTab"),
    false,
    "links.focusNewTab must not be contributed until a plugin reads it",
  );
  assert.equal(
    props.has("lumiere.markdown.vault.showUnsupportedFiles"),
    false,
    "vault.showUnsupportedFiles must not be contributed until a plugin reads it",
  );
});

test("generated contributions omit the unread reserved settings", async () => {
  const generated = await contributions();
  const props = generated.configuration.properties;
  assert.equal(
    Object.hasOwn(props, "lumiere.markdown.links.focusNewTab"),
    false,
    "links.focusNewTab must not be generated until it is in active manifest.config",
  );
  assert.equal(
    Object.hasOwn(props, "lumiere.markdown.vault.showUnsupportedFiles"),
    false,
    "vault.showUnsupportedFiles must not be generated until it is in active manifest.config",
  );
});
