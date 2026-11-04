import test from "node:test";
import assert from "node:assert/strict";
import {
  isMarkdownAbsentOnDisk,
  isMissingMarkdownFileUri,
  setMarkdownAbsentOnDiskForTests,
} from "../../../src/host/markdown-absent-on-disk";

test("isMissingMarkdownFileUri accepts file Markdown paths only", () => {
  assert.equal(isMissingMarkdownFileUri("file:///vault/test.md"), true);
  assert.equal(isMissingMarkdownFileUri("file:///vault/Note.markdown"), true);
  assert.equal(isMissingMarkdownFileUri("file:///vault/a.ts"), false);
  assert.equal(isMissingMarkdownFileUri("untitled:test.md"), false);
  assert.equal(isMissingMarkdownFileUri("git:/vault/Note.md"), false);
});

test("isMarkdownAbsentOnDisk uses the test override without touching disk", () => {
  try {
    setMarkdownAbsentOnDiskForTests((uri) => uri.endsWith("ghost.md"));
    assert.equal(isMarkdownAbsentOnDisk("file:///vault/ghost.md"), true);
    assert.equal(isMarkdownAbsentOnDisk("file:///vault/real.md"), false);
    assert.equal(isMarkdownAbsentOnDisk("untitled:/vault/ghost.md"), false);
  } finally {
    setMarkdownAbsentOnDiskForTests();
  }
});

test("isMarkdownAbsentOnDisk default reports a surely-missing file path", () => {
  setMarkdownAbsentOnDiskForTests();
  const missing =
    "file:///tmp/lumia-definitely-missing-open-bridge-test/nope.md";
  assert.equal(isMarkdownAbsentOnDisk(missing), true);
});
