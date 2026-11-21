import test from "node:test";
import assert from "node:assert/strict";
import { embedIsWiki } from "../../../src/plugins/embeds/post-process";
import { openedVaultTarget } from "../../../src/plugins/links/target";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";
import { linkLocation } from "../../../src/shared/link-location";

test("Open image file for a Markdown embed resolves the sibling, not the vault-root twin", () => {
  const root = "file:///vault";
  const vault = new MemoryVaultIndex({
    root,
    folderNote: "",
    linkFormat: "shortest",
  });
  vault.replaceFiles(
    ["image.png", "notes/source.md", "notes/image.png"].map((path) => ({
      uri: `${root}/${path}`,
      path,
      mtime: 1,
      size: 1,
    })),
  );

  // Markdown image markup has no data-wiki → wiki:false for Open.
  assert.equal(embedIsWiki({ dataset: {} }), false);

  // Wikilink open uses the vault index, which prefers the vault root.
  assert.equal(
    openedVaultTarget(vault, "image.png", "notes/source.md", true),
    `${root}/image.png`,
  );

  // Markdown open is left to navigation, which looks beside the source note.
  assert.equal(
    openedVaultTarget(vault, "image.png", "notes/source.md", false),
    undefined,
  );
  // The sibling comes first; the vault root is only the fallback.
  assert.deepEqual(linkLocation("image.png").folders, ["source", "vault"]);
});
