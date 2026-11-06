import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MARKDOWN_GLOB,
  isMarkdownPath,
  scanExclude,
} from "../../src/shared/markdown-scan";

test("notes are .md and .markdown, in any case", () => {
  for (const path of ["/a/n.md", "/a/n.markdown", "/a/N.MD", "/a/n.Markdown"]) {
    assert.equal(isMarkdownPath(path), true, path);
  }
  for (const path of ["/a/n.mdx", "/a/n.md.bak", "/a/markdown", "/a/n.pdf"]) {
    assert.equal(isMarkdownPath(path), false, path);
  }
  assert.equal(MARKDOWN_GLOB, "**/*.{md,markdown}");
});

test("the exclude joins the dependency folders with what files.exclude hides", () => {
  assert.equal(scanExclude(undefined), "{**/node_modules/**,**/.git/**}");
  assert.equal(
    scanExclude({
      "**/.git": true,
      "**/.DS_Store": true,
      "**/shown": false,
      "**/generated": { when: "$(basename).ts" },
    }),
    "{**/node_modules/**,**/.git/**,**/.git,**/.DS_Store}",
  );
});

test("a malformed files.exclude adds nothing", () => {
  for (const value of [null, "**/x", 3, true, []]) {
    assert.equal(scanExclude(value), "{**/node_modules/**,**/.git/**}");
  }
});
