import test from "node:test";
import assert from "node:assert/strict";
import { fileUriOfPath, noteLocation } from "../src/handoff";

test("a local note outside the workspace is named by its plain absolute path", () => {
  assert.equal(
    noteLocation("file:///notes/%E8%B5%A0%E7%A4%BC/a%EF%BC%881%EF%BC%89.md"),
    "/notes/赠礼/a（1）.md",
  );
  assert.equal(noteLocation("file:///vault/A.md"), "/vault/A.md");
});

test("spaces stay as they are, not percent-encoded, so agents read the path as written", () => {
  const uri =
    "file:///vault/projects/AI%20%E6%B4%BB%E5%8A%A8/BCS%2041350%20%E4%BF%AE%E5%A4%8D.md";
  assert.equal(noteLocation(uri), "/vault/projects/AI 活动/BCS 41350 修复.md");
  assert.equal(fileUriOfPath(noteLocation(uri)), uri);
  assert.equal(noteLocation("file:///My%20Notes/a.md"), "/My Notes/a.md");
});

test("a location a plain path would not name unambiguously keeps its URI", () => {
  for (const uri of [
    "file:///a%09b.md",
    "file:///a%23b.md",
    "file:///100%25.md",
    "file:///a%0Ab.md",
    "file:///C:/notes/a.md",
    "file://server/share/a.md",
    "vscode-remote://ssh-remote+dev/notes/a.md",
    "untitled:Untitled-1",
  ]) {
    assert.equal(noteLocation(uri), uri);
  }
});

test("a plain path reads back as the same file URI", () => {
  const uri = "file:///notes/%E8%B5%A0%E7%A4%BC/a%EF%BC%881%EF%BC%89.md";
  assert.equal(fileUriOfPath(noteLocation(uri)), uri);
});
