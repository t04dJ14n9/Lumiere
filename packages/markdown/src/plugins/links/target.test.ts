import test from "node:test";
import assert from "node:assert/strict";
import { mayCreateNote, openedVaultTarget } from "./target";
import type { VaultFile } from "../vault/api";

const file = {
  path: "wiki/topic.md",
  uri: "file:///vault/wiki/topic.md",
} as VaultFile;

test("a wikilink opens the file the vault index picks", () => {
  const vault = { resolveLink: () => file };
  assert.equal(
    openedVaultTarget(vault, "topic", "notes/source.md", true),
    file.uri,
  );
});

test("a markdown link is left to file-system navigation", () => {
  let resolved = false;
  const vault = {
    resolveLink: () => {
      resolved = true;
      return file;
    },
  };
  assert.equal(
    openedVaultTarget(vault, "/wiki/topic.md", "wiki/notes/source.md", false),
    undefined,
  );
  assert.equal(resolved, false);
});

test("mayCreateNote allows basename notes only", () => {
  assert.equal(mayCreateNote("Missing"), true);
  assert.equal(mayCreateNote("Missing.md"), true);
  assert.equal(mayCreateNote("Missing.markdown"), true);
  assert.equal(mayCreateNote("folder/Missing"), false);
  assert.equal(mayCreateNote("./Missing"), false);
  assert.equal(mayCreateNote("../Missing"), false);
  assert.equal(mayCreateNote("photo.png"), false);
  assert.equal(mayCreateNote(""), false);
  assert.equal(mayCreateNote("."), false);
});
