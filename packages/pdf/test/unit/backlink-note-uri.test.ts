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
