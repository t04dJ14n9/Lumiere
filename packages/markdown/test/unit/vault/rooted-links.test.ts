import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../../../src/markdown/metadata";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import { linkLocation } from "../../../src/shared/link-location";

// A folder with an `index.md` and typed notes, as an LLM wiki writes it.
// It is an ordinary folder: a leading `/` still starts at the vault root.
test("a /-rooted Markdown link resolves from the vault root inside wiki/", () => {
  const vault = new MemoryVaultIndex({
    root: "file:///vault",
    folderNote: "",
    linkFormat: "shortest",
  });
  vault.replaceFiles(
    ["wiki/index.md", "wiki/hot.md", "wiki/resources/notes/ARP.md"].map(
      (path) => ({
        uri: `file:///vault/${path}`,
        path,
        mtime: 1,
        size: 1,
      }),
    ),
  );
  vault.setMetadata("wiki/index.md", metadata("---\ntype: meta\n---\n"));
  vault.setMetadata(
    "wiki/hot.md",
    metadata("See [ARP](/wiki/resources/notes/ARP.md)."),
  );
  assert.equal(
    vault.resolveLink("/wiki/resources/notes/ARP.md", "wiki/hot.md", "markdown")
      ?.path,
    "wiki/resources/notes/ARP.md",
  );
  assert.equal(vault.unresolvedLinks("wiki/hot.md").size, 0);
  assert.deepEqual(linkLocation("/wiki/resources/notes/ARP.md", false), {
    relative: "wiki/resources/notes/ARP.md",
    folders: ["vault"],
  });
});
