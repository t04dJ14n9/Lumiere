/**
 * Which PDF a note's link names must be the PDF the Markdown editor opens
 * for the same link (packages/markdown navigation): `./`, `../` and a bare
 * name from the note's folder; a leading `/` from the vault root; any other
 * foldered path from the vault root first, else the note's folder.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractPdfBacklinks,
  PdfBacklinkIndex,
  type PdfFile,
} from "../../src/shared/pdf-backlink-index";
import { pdfKeysOfLinkPath } from "../../src/shared/pdf-backlink-key";

const NOTE = "notes/sub/n.md";

test("./, ../ and a bare name are relative to the note's folder only", () => {
  assert.deepEqual(pdfKeysOfLinkPath("./a.pdf", NOTE), {
    pdfKey: "notes/sub/a.pdf",
  });
  assert.deepEqual(pdfKeysOfLinkPath("../a.pdf", NOTE), {
    pdfKey: "notes/a.pdf",
  });
  assert.deepEqual(pdfKeysOfLinkPath("a.pdf", NOTE), {
    pdfKey: "notes/sub/a.pdf",
  });
  assert.deepEqual(pdfKeysOfLinkPath("./papers/../a.pdf", NOTE), {
    pdfKey: "notes/sub/a.pdf",
  });
  assert.deepEqual(pdfKeysOfLinkPath("a.pdf", "n.md"), { pdfKey: "a.pdf" });
});

test("a leading / is the vault root, and an absolute path also names a PDF outside the workspace", () => {
  assert.deepEqual(pdfKeysOfLinkPath("/papers/a.pdf", NOTE), {
    pdfKey: "papers/a.pdf",
    externalKey: "/papers/a.pdf",
  });
});

test("any other foldered path is the vault root first, else the note's folder", () => {
  assert.deepEqual(pdfKeysOfLinkPath("papers/a.pdf", NOTE), {
    pdfKey: "papers/a.pdf",
    fallbackKey: "notes/sub/papers/a.pdf",
  });
  assert.deepEqual(
    pdfKeysOfLinkPath("papers/a.pdf", "n.md"),
    { pdfKey: "papers/a.pdf" },
    "a note at the vault root has no other reading",
  );
  assert.deepEqual(pdfKeysOfLinkPath("papers/my%20a.pdf", NOTE), {
    pdfKey: "papers/my a.pdf",
    fallbackKey: "notes/sub/papers/my a.pdf",
  });
  assert.deepEqual(pdfKeysOfLinkPath("C:/Users/me/a.pdf", NOTE), {
    pdfKey: "C:/Users/me/a.pdf",
    fallbackKey: "notes/sub/C:/Users/me/a.pdf",
    externalKey: "C:/Users/me/a.pdf",
  });
});

test("a path that climbs out of the vault names no PDF, as the editor refuses it", () => {
  assert.equal(pdfKeysOfLinkPath("../../../a.pdf", NOTE), undefined);
  assert.equal(pdfKeysOfLinkPath("papers/../../a.pdf", NOTE), undefined);
  assert.equal(pdfKeysOfLinkPath("../a.pdf", "n.md"), undefined);
});

test("a file URL names the PDF by its path", () => {
  assert.deepEqual(pdfKeysOfLinkPath("file:///Users/me/a%20b.pdf", NOTE), {
    pdfKey: "Users/me/a b.pdf",
    externalKey: "/Users/me/a b.pdf",
  });
});

test("the index keys a foldered link under both readings", () => {
  const [hit] = extractPdfBacklinks("[x](papers/a.pdf#page=1)", NOTE, "u");
  assert.equal(hit?.pdfKey, "papers/a.pdf");
  const index = new PdfBacklinkIndex();
  index.replaceNote("u", NOTE, "[x](papers/a.pdf#page=1)");
  assert.equal(index.lookup("papers/a.pdf").length, 1);
  assert.equal(
    index.lookup("notes/sub/papers/a.pdf").length,
    0,
    "the note-relative reading applies only if the vault-root file is not there",
  );
});

function fileSystem(files: string[]) {
  const asked: string[] = [];
  return {
    asked,
    isFile: async (file: PdfFile) => {
      asked.push(`${file.folder}:${file.path}`);
      return files.includes(`${file.folder}:${file.path}`);
    },
  };
}

test("hitsFor opens a foldered link at the vault root when that file exists", async () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("u", NOTE, "[x](papers/a.pdf#page=3)", "A");
  const both = fileSystem(["A:papers/a.pdf", "A:notes/sub/papers/a.pdf"]);
  const root = await index.hitsFor(
    { folder: "A", path: "papers/a.pdf" },
    both.isFile,
  );
  assert.equal(root.length, 1);
  const beside = await index.hitsFor(
    { folder: "A", path: "notes/sub/papers/a.pdf" },
    both.isFile,
  );
  assert.deepEqual(beside, [], "the vault-root file wins, as when clicked");
  assert.deepEqual(both.asked, ["A:papers/a.pdf"]);
});

test("hitsFor falls back to the note's folder when there is no vault-root file", async () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("u", NOTE, "[x](papers/a.pdf#page=3)", "A");
  const only = fileSystem(["A:notes/sub/papers/a.pdf"]);
  const hits = await index.hitsFor(
    { folder: "A", path: "notes/sub/papers/a.pdf" },
    only.isFile,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, "notes/sub/papers/a.pdf", "keyed as this PDF");
  assert.equal(hits[0]!.page, 3);
});

test("hitsFor asks about each vault-root file once and only for links that need it", async () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote(
    "u1",
    NOTE,
    "[x](papers/a.pdf#page=1) [y](papers/a.pdf#page=2) [z](./b.pdf#page=1)",
    "A",
  );
  index.replaceNote("u2", "notes/sub/m.md", "[w](papers/a.pdf#page=3)", "A");
  const system = fileSystem([]);
  const hits = await index.hitsFor(
    { folder: "A", path: "notes/sub/papers/a.pdf" },
    system.isFile,
  );
  assert.equal(hits.length, 3);
  assert.deepEqual(system.asked, ["A:papers/a.pdf"]);
  const unrelated = fileSystem([]);
  await index.hitsFor(
    { folder: "A", path: "notes/sub/b.pdf" },
    unrelated.isFile,
  );
  assert.deepEqual(unrelated.asked, [], "a ./ link needs no lookup");
});

test("two folders of a multi-root workspace do not share papers/a.pdf", async () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("a-note", "n.md", "[x](papers/a.pdf#page=1)", "folder-A");
  index.replaceNote("b-note", "n.md", "[y](papers/a.pdf#page=2)", "folder-B");
  const none = async () => true;
  const a = await index.hitsFor(
    { folder: "folder-A", path: "papers/a.pdf" },
    none,
  );
  const b = await index.hitsFor(
    { folder: "folder-B", path: "papers/a.pdf" },
    none,
  );
  assert.deepEqual(
    [a.map((hit) => hit.noteUri), b.map((hit) => hit.noteUri)],
    [["a-note"], ["b-note"]],
  );
  assert.equal(index.lookup("papers/a.pdf", "folder-C").length, 0);
  assert.equal(index.lookup("papers/a.pdf").length, 0, "no folder is its own");
  index.removeNote("a-note");
  assert.equal(index.lookup("papers/a.pdf", "folder-A").length, 0);
  assert.equal(index.lookup("papers/a.pdf", "folder-B").length, 1);
});

test("replacing or removing a note clears every key it was filed under", async () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote(
    "u",
    NOTE,
    "[x](papers/a.pdf#page=1) [y](/abs/b.pdf#page=1)",
    "A",
  );
  index.replaceNote("u", NOTE, "[x](papers/c.pdf#page=1)", "A");
  const no = async () => false;
  assert.deepEqual(
    await index.hitsFor({ folder: "A", path: "papers/a.pdf" }, no),
    [],
  );
  assert.deepEqual(
    await index.hitsFor({ folder: "A", path: "notes/sub/papers/a.pdf" }, no),
    [],
  );
  assert.deepEqual(index.lookup("/abs/b.pdf"), []);
  assert.equal(index.lookup("papers/c.pdf", "A").length, 1);
  index.removeNote("u");
  assert.equal(
    (await index.hitsFor({ folder: "A", path: "notes/sub/papers/c.pdf" }, no))
      .length,
    0,
  );
  assert.equal(index.lookup("papers/c.pdf", "A").length, 0);
});

test("a PDF outside every workspace folder is found by its absolute path", () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("u", NOTE, "[x](/Users/me/outside.pdf#page=2)", "A");
  const hits = index.lookup("/Users/me/outside.pdf");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, "/Users/me/outside.pdf");
  assert.equal(hits[0]!.page, 2);
});

test("the open PDF's own path is never decoded when it is looked up", () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("u", "n.md", "[x](a%2520b.pdf#page=1)");
  assert.equal(index.lookup("a%20b.pdf").length, 1);
  assert.equal(index.lookup("a b.pdf").length, 0);
});
