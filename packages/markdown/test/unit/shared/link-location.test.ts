import test from "node:test";
import assert from "node:assert/strict";
import {
  followsNewNoteFolder,
  linkLocation,
} from "../../../src/shared/link-location";

test("./ and ../ are only ever the source note's folder", () => {
  for (const link of ["./Sib.md", "../b/O.md", "./", "..", "."]) {
    for (const create of [false, true]) {
      assert.deepEqual(linkLocation(link, create), {
        relative: link,
        folders: ["source"],
      });
    }
  }
});

test("a leading slash is the vault root, without the slash", () => {
  assert.deepEqual(linkLocation("/wiki/Note.md", false), {
    relative: "wiki/Note.md",
    folders: ["vault"],
  });
});

test("a foldered path tries the vault root, then the source folder, on a lookup", () => {
  assert.deepEqual(linkLocation("sub/N.md", false), {
    relative: "sub/N.md",
    folders: ["vault", "source"],
  });
});

test("a foldered path is only made at the vault root", () => {
  assert.deepEqual(linkLocation("wiki/area/Note", true), {
    relative: "wiki/area/Note",
    folders: ["vault"],
  });
});

test("a bare name is the source note's neighbour, or the vault when creating", () => {
  assert.deepEqual(linkLocation("Note.md", false).folders, ["source"]);
  assert.deepEqual(linkLocation("Note.md", true).folders, ["vault"]);
});

test("a dot in a name does not make a path relative", () => {
  assert.deepEqual(linkLocation(".hidden/Note.md", false).folders, [
    "vault",
    "source",
  ]);
  assert.deepEqual(linkLocation("..notes", false).folders, ["source"]);
});

test("only a bare file name follows the new-note folder", () => {
  assert.equal(followsNewNoteFolder("Note"), true);
  assert.equal(followsNewNoteFolder("a/Note"), false);
  assert.equal(followsNewNoteFolder("./Note"), false);
  assert.equal(followsNewNoteFolder("/Note"), false);
});
