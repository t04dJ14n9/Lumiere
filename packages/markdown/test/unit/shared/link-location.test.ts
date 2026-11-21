import test from "node:test";
import assert from "node:assert/strict";
import {
  creationLocation,
  followsNewNoteFolder,
  linkLocation,
} from "../../../src/shared/link-location";

test("./ and ../ are only ever the source note's folder", () => {
  for (const link of ["./Sib.md", "../b/O.md", "./", "..", "."]) {
    assert.deepEqual(linkLocation(link), {
      relative: link,
      folders: ["source"],
    });
    assert.deepEqual(creationLocation(link), {
      relative: link,
      folder: "source",
    });
  }
});

test("a leading slash is the vault root, without the slash", () => {
  assert.deepEqual(linkLocation("/wiki/Note.md"), {
    relative: "wiki/Note.md",
    folders: ["vault"],
  });
  assert.deepEqual(creationLocation("/wiki/Note.md"), {
    relative: "wiki/Note.md",
    folder: "vault",
  });
});

test("a foldered path tries the vault root, then the source folder, on a lookup", () => {
  assert.deepEqual(linkLocation("sub/N.md"), {
    relative: "sub/N.md",
    folders: ["vault", "source"],
  });
});

test("a foldered path is only made at the vault root", () => {
  assert.deepEqual(creationLocation("wiki/area/Note"), {
    relative: "wiki/area/Note",
    folder: "vault",
  });
});

test("a bare name is the source note's neighbour, then the vault root's file", () => {
  assert.deepEqual(linkLocation("Note.md").folders, ["source", "vault"]);
  assert.deepEqual(linkLocation(".hidden.md").folders, ["source", "vault"]);
});

test("a bare name is made at the vault root", () => {
  assert.deepEqual(creationLocation("Note.md"), {
    relative: "Note.md",
    folder: "vault",
  });
});

test("a dot in a name does not make a path relative", () => {
  assert.deepEqual(linkLocation(".hidden/Note.md").folders, [
    "vault",
    "source",
  ]);
  assert.deepEqual(linkLocation("..notes").folders, ["source", "vault"]);
  assert.equal(creationLocation("..notes").folder, "vault");
  assert.equal(creationLocation(".hidden/Note.md").folder, "vault");
});

test("only a bare file name follows the new-note folder", () => {
  assert.equal(followsNewNoteFolder("Note"), true);
  assert.equal(followsNewNoteFolder("a/Note"), false);
  assert.equal(followsNewNoteFolder("./Note"), false);
  assert.equal(followsNewNoteFolder("/Note"), false);
});
