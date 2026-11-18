import test from "node:test";
import assert from "node:assert/strict";
import { openedVaultTarget } from "../../../src/plugins/links/target";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";

test("markdown leaves a conflicting vault-root twin for navigation", () => {
  const vault = new MemoryVaultIndex({
    root: "file:///vault",
    folderNote: "",
    linkFormat: "shortest",
  });
  vault.replaceFiles(
    ["topic.md", "notes/topic.md", "notes/source.md"].map((path) => ({
      uri: `file:///vault/${path}`,
      path,
      mtime: 1,
      size: 1,
    })),
  );
  // Index-first lookup would prefer the root twin; Markdown must not.
  assert.equal(
    vault.resolveLink("topic.md", "notes/source.md", "markdown")?.path,
    "topic.md",
  );
  assert.equal(
    openedVaultTarget(vault, "topic.md", "notes/source.md", false),
    undefined,
  );
  assert.equal(
    openedVaultTarget(vault, "topic.md", "notes/source.md", true),
    "file:///vault/topic.md",
  );
});
