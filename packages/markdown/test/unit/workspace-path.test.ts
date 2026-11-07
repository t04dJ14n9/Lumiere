import assert from "node:assert/strict";
import test from "node:test";
import { metadata } from "../../src/markdown/metadata";
import { portableMarkdownLink } from "../../src/shared/markdown-link";
import {
  encodeLinkPath,
  joinContained,
  relativeFilePath,
  walksSymbolicLink,
} from "../../src/shared/workspace-path";

test("a decoded file URI stays inside its workspace folder", () => {
  assert.equal(
    relativeFilePath("file:///vault/folder/A%20B.md", "file:///vault"),
    "folder/A B.md",
  );
});

test("joinContained refuses a path that escapes the root", () => {
  assert.equal(joinContained("file:///proj", "assets/../secret"), undefined);
  assert.equal(joinContained("file:///proj", "/etc/passwd"), undefined);
  assert.equal(
    joinContained("file:///proj", "assets/fig.png"),
    "file:///proj/assets/fig.png",
  );
});

test("a symbolic link on the path blocks a write, and a missing file does not", async () => {
  const linked = new Set(["file:///proj/assets"]);
  assert.equal(
    await walksSymbolicLink("assets/fig.png", "file:///proj", async (uri) =>
      linked.has(uri),
    ),
    true,
  );
  assert.equal(
    await walksSymbolicLink(
      "assets/fig.png",
      "file:///proj",
      async () => false,
    ),
    false,
  );
  assert.equal(
    await walksSymbolicLink("../secret", "file:///proj", async () => false),
    true,
  );
});

test("encodeLinkPath encodes parentheses so portableMarkdownLink parses whole", () => {
  assert.equal(
    encodeLinkPath("a (1)/section 1).md"),
    "a%20%281%29/section%201%29.md",
  );
  const link = portableMarkdownLink("index.md", "section 1).md");
  assert.equal(link, "[section 1)](section%201%29.md)");
  assert.equal(metadata(link).links[0]?.link, "section%201%29.md");
});
