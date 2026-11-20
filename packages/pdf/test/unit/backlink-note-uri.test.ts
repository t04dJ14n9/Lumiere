import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrustedBacklinkNoteUri } from "../../src/shared/backlink-note-uri";

const ok = {
  noteUri: "file:///work/notes/a.md",
  scheme: "file",
  path: "/work/notes/a.md",
  inWorkspace: true,
};

test("allows workspace Markdown on file / vscode-vfs / vscode-remote", () => {
  for (const scheme of ["file", "vscode-vfs", "vscode-remote"]) {
    assert.equal(
      isTrustedBacklinkNoteUri({
        ...ok,
        scheme,
        noteUri: `${scheme}://host/a.md`,
      }),
      true,
      scheme,
    );
  }
});

test("rejects non-workspace schemes even with inWorkspace true", () => {
  for (const scheme of ["http", "https", "command", "untitled", "vscode"]) {
    assert.equal(
      isTrustedBacklinkNoteUri({
        ...ok,
        scheme,
        noteUri: `${scheme}:something`,
      }),
      false,
      scheme,
    );
  }
});

test("allows .markdown notes, which the backlink index scans too", () => {
  assert.equal(
    isTrustedBacklinkNoteUri({
      ...ok,
      path: "/work/notes/a.markdown",
      noteUri: "file:///work/notes/a.markdown",
    }),
    true,
  );
});

test("rejects URIs outside a workspace folder", () => {
  assert.equal(isTrustedBacklinkNoteUri({ ...ok, inWorkspace: false }), false);
});

test("rejects non-Markdown paths", () => {
  assert.equal(
    isTrustedBacklinkNoteUri({
      ...ok,
      path: "/work/notes/a.txt",
      noteUri: "file:///work/notes/a.txt",
    }),
    false,
  );
  assert.equal(
    isTrustedBacklinkNoteUri({
      ...ok,
      path: "/work/secret.pdf",
      noteUri: "file:///work/secret.pdf",
    }),
    false,
  );
});

test("rejects encoded path separators in the raw noteUri", () => {
  assert.equal(
    isTrustedBacklinkNoteUri({
      ...ok,
      noteUri: "file:///work/notes%2f../secret.md",
    }),
    false,
  );
  assert.equal(
    isTrustedBacklinkNoteUri({
      ...ok,
      noteUri: "file:///work/notes%5csecret.md",
    }),
    false,
  );
});

test("rejects . and .. segments, written or percent-encoded", () => {
  for (const [noteUri, path] of [
    ["file:///work/../etc/a.md", "/work/../etc/a.md"],
    ["file:///work/notes/./a.md", "/work/notes/./a.md"],
    ["file:///work/%2e%2e/etc/a.md", "/work/%2e%2e/etc/a.md"],
    ["file:///work/%2E%2E/etc/a.md", "/work/../etc/a.md"],
  ] as const) {
    assert.equal(
      isTrustedBacklinkNoteUri({ ...ok, noteUri, path }),
      false,
      noteUri,
    );
  }
  // A name that merely contains dots is a name.
  assert.equal(
    isTrustedBacklinkNoteUri({
      ...ok,
      noteUri: "file:///work/notes/..draft.md",
      path: "/work/notes/..draft.md",
    }),
    true,
  );
});
