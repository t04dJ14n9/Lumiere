import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isMarkdownAbsentOnDisk,
  isMarkdownFileUri,
  setMarkdownAbsentOnDiskForTests,
} from "../../../src/host/markdown-absent-on-disk";

test("isMarkdownFileUri accepts file Markdown paths only", () => {
  assert.equal(isMarkdownFileUri("file:///vault/test.md"), true);
  assert.equal(isMarkdownFileUri("file:///vault/Note.markdown"), true);
  assert.equal(isMarkdownFileUri("file:///vault/a.ts"), false);
  assert.equal(isMarkdownFileUri("untitled:test.md"), false);
  assert.equal(isMarkdownFileUri("git:/vault/Note.md"), false);
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
  // A real absolute path: a file URL without a drive letter is no path on Windows.
  const missing = pathToFileURL(
    join(tmpdir(), "lumiere-definitely-missing-open-bridge-test", "nope.md"),
  ).href;
  assert.equal(isMarkdownAbsentOnDisk(missing), true);
});
