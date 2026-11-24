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

test("a location a plain path would not name unambiguously keeps its URI", () => {
  for (const uri of [
    "file:///My%20Notes/a.md",
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
