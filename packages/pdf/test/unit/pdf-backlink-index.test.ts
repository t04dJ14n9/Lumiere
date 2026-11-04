import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractPdfBacklinks,
  PdfBacklinkIndex,
} from "../../src/shared/pdf-backlink-index";

test("extractPdfBacklinks finds page+text links and ignores non-pdf", () => {
  const md = [
    "See [x](papers/a.pdf#page=3#:~:text=hello)",
    "and [y](notes/other.md#page=1)",
    "legacy [z](papers/a.pdf#hl-deadbeef)",
  ].join("\n");
  const hits = extractPdfBacklinks(md, "notes/n.md", "file:///notes/n.md");
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.page, 3);
  assert.equal(hits[0]!.textFragment?.textStart, "hello");
  assert.equal(hits[1]!.highlightId, "hl-deadbeef");
});

test("lookup returns only that PDF's hits", () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote(
    "u1",
    "n.md",
    "[a](papers/a.pdf#page=1)\n[b](papers/b.pdf#page=2)",
  );
  assert.equal(index.lookup("papers/a.pdf").length, 1);
  assert.equal(index.lookup("papers/b.pdf").length, 1);
});

test("replaceNote refreshes without full rebuild API on open", () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote("u1", "n.md", "[a](papers/a.pdf#page=1)");
  index.replaceNote("u1", "n.md", "[a](papers/a.pdf#page=9#:~:text=z)");
  assert.equal(index.lookup("papers/a.pdf")[0]!.page, 9);
});

test("extractPdfBacklinks resolves ../ against note directory", () => {
  const hits = extractPdfBacklinks(
    "[x](../papers/a.pdf#page=3#:~:text=hi)",
    "notes/n.md",
    "file:///notes/n.md",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, "papers/a.pdf");
  assert.equal(hits[0]!.page, 3);
  assert.equal(hits[0]!.textFragment?.textStart, "hi");
});

test("extractPdfBacklinks resolves ./ sibling against note directory", () => {
  const hits = extractPdfBacklinks(
    "[x](./sib.pdf#page=1)",
    "notes/n.md",
    "file:///notes/n.md",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, "notes/sib.pdf");
});

test("extractPdfBacklinks resolves bare filename against note directory", () => {
  const hits = extractPdfBacklinks(
    "[x](sib.pdf#page=1)",
    "notes/n.md",
    "file:///notes/n.md",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, "notes/sib.pdf");
});

test("extractPdfBacklinks keeps workspace-relative path without relative prefix", () => {
  const hits = extractPdfBacklinks(
    "[x](papers/a.pdf#page=3#:~:text=hi)",
    "notes/n.md",
    "file:///notes/n.md",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, "papers/a.pdf");
});

test("index lookup finds note-relative ../ target under workspace-relative key", () => {
  const index = new PdfBacklinkIndex();
  index.replaceNote(
    "file:///notes/n.md",
    "notes/n.md",
    "[x](../papers/a.pdf#page=3#:~:text=hi)",
  );
  const hits = index.lookup("papers/a.pdf");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, "papers/a.pdf");
  assert.equal(hits[0]!.page, 3);
  assert.equal(hits[0]!.textFragment?.textStart, "hi");
});
