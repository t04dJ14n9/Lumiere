import assert from "node:assert/strict";
import test from "node:test";
import { unlinkedAttachments } from "../../../src/plugins/attachments/unlinked";
import { memoryVaults } from "../views/fakes";

function vault() {
  return memoryVaults({
    "A.md": "![[only-a.png]] ![[shared.png]] [[B]] [A](docs/spec.pdf)",
    "B.md": "![[shared.png]]",
    "C.md": "![[only-c.png]] ![[A]] [[board.canvas]]",
    "only-a.png": "",
    "only-c.png": "",
    "shared.png": "",
    "docs/spec.pdf": "",
    "board.canvas": "",
  }).index;
}

const paths = (files: readonly { path: string }[]) =>
  files.map((file) => file.path).sort();

test("only attachments no other note links to are offered", () => {
  assert.deepEqual(paths(unlinkedAttachments(vault(), ["A.md"])), [
    "docs/spec.pdf",
    "only-a.png",
  ]);
});

test("deleting several notes together frees what they alone shared", () => {
  assert.deepEqual(paths(unlinkedAttachments(vault(), ["A.md", "B.md"])), [
    "docs/spec.pdf",
    "only-a.png",
    "shared.png",
  ]);
});

test("notes, canvases and bases are never offered, only attachments", () => {
  assert.deepEqual(paths(unlinkedAttachments(vault(), ["C.md"])), [
    "only-c.png",
  ]);
});

test("an attachment deleted with the notes is not offered a second time", () => {
  assert.deepEqual(
    paths(unlinkedAttachments(vault(), ["A.md", "only-a.png"])),
    ["docs/spec.pdf"],
  );
});

test("a note that is not in the vault frees nothing", () => {
  assert.deepEqual(unlinkedAttachments(vault(), ["Missing.md"]), []);
});
