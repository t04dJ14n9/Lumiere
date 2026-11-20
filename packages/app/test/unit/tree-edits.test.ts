// F36: where the file tree's new notes and folders go, what a typed name
// may be, and where a dragged row may land.
import test from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../../src/shell/tree";
import {
  childPath,
  dropTarget,
  folderFor,
  freeName,
  nameProblem,
  parentOf,
  takenPaths,
} from "../../src/shell/tree-edits";
import { visibleRows } from "../../src/shell/tree-rows";

test("a new note or folder takes the first free Untitled name in its folder", () => {
  const taken = takenPaths(["Untitled.md", "Untitled 1.md", "a/b/c.md"]);
  assert.equal(freeName(taken, "", { extension: ".md" }), "Untitled 2.md");
  assert.equal(freeName(taken, "a", { extension: ".md" }), "a/Untitled.md");
  // A folder above a listed file is taken too.
  assert.equal(freeName(takenPaths(["Untitled/x.md"]), "", {}), "Untitled 1");
});

test("a typed name may not be empty, hold a slash, or name . and ..", () => {
  for (const name of ["", "  ", "a/b", "a\\b", ".", "..", " lead", "trail "]) {
    assert.notEqual(nameProblem(name), undefined, JSON.stringify(name));
  }
  assert.equal(nameProblem("Plan (v2).md"), undefined);
});

test("a dragged row lands in another folder, never in itself or where it is", () => {
  assert.equal(dropTarget("a/x.md", "b"), "b/x.md");
  assert.equal(dropTarget("a/x.md", ""), "x.md");
  assert.equal(dropTarget("a/x.md", "a"), undefined);
  assert.equal(dropTarget("a", "a"), undefined);
  assert.equal(dropTarget("a", "a/b"), undefined);
  assert.equal(dropTarget("a", "ab"), "ab/a");
  assert.equal(dropTarget("x.md", ""), undefined);
});

test("a row's New Note goes in the folder, or in the file's folder", () => {
  assert.equal(folderFor({ kind: "folder", path: "a/b" }), "a/b");
  assert.equal(folderFor({ kind: "file", path: "a/b/c.md" }), "a/b");
  assert.equal(folderFor({ kind: "file", path: "c.md" }), "");
  assert.equal(parentOf("a/b"), "a");
  assert.equal(childPath("", "x"), "x");
});

test("an empty folder made in the window shows among the listed ones, sorted", () => {
  const root = buildTree([{ path: "m/x.md", kind: "note" }], ["a/new"]);
  assert.deepEqual(
    visibleRows(root, new Set(["a"])).map((row) => row.path),
    ["a", "a/new", "m"],
  );
});
