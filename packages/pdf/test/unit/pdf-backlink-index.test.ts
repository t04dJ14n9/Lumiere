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
    "and [z](papers/a.pdf#some-heading)",
  ].join("\n");
  const hits = extractPdfBacklinks(md, "notes/n.md", "file:///notes/n.md");
  assert.equal(
    hits.length,
    1,
    "no hit for a non-PDF or a fragment without a page",
  );
  assert.equal(hits[0]!.page, 3);
  assert.equal(hits[0]!.textFragment?.textStart, "hello");
});

test("extractPdfBacklinks skips what is not a link: code, comments, escapes", () => {
  const md = [
    "```markdown",
    "[fenced](papers/a.pdf#page=2#:~:text=fenced)",
    "```",
    "Inline `[code](papers/a.pdf#page=3#:~:text=code)` and",
    "<!-- [comment](papers/a.pdf#page=4#:~:text=comment) -->",
    "\\[escaped](papers/a.pdf#page=5#:~:text=escaped)",
    "but [real](papers/a.pdf#page=6#:~:text=real) and",
    "![embed](papers/a.pdf#page=7#:~:text=embed)",
  ].join("\n");
  const hits = extractPdfBacklinks(md, "notes/n.md", "file:///notes/n.md");
  assert.deepEqual(
    hits.map((hit) => [hit.page, hit.linkOffset]),
    [
      [6, md.indexOf("[real]")],
      [7, md.indexOf("[embed]")],
    ],
  );
});

function pagesOf(markdown: string): number[] {
  return extractPdfBacklinks(markdown, "notes/n.md", "file:///notes/n.md").map(
    (hit) => hit.page!,
  );
}

test("a comment opener inside code is text: later links stay", () => {
  const fenced = [
    "```markdown",
    "<!-- an example comment",
    "```",
    "[a](papers/a.pdf#page=2)",
    "a stray --> in prose",
    "[b](papers/a.pdf#page=3)",
  ].join("\n");
  assert.deepEqual(pagesOf(fenced), [2, 3]);
  const spans = [
    "Write `<!--` to open a comment.",
    "[a](papers/a.pdf#page=2)",
    "and `-->` to close it, then [b](papers/a.pdf#page=3)",
  ].join("\n");
  assert.deepEqual(pagesOf(spans), [2, 3]);
});

test("a fence marker inside a comment is not a fence", () => {
  const md = [
    "<!--",
    "```",
    "[hidden](papers/a.pdf#page=9)",
    "-->",
    "[real](papers/a.pdf#page=2)",
  ].join("\n");
  assert.deepEqual(pagesOf(md), [2]);
});

test("a lone <!-- in prose is text, not a comment running to the end", () => {
  const md = "Use <!-- to start one.\n[real](papers/a.pdf#page=2)";
  assert.deepEqual(pagesOf(md), [2]);
});

test("a line that merely starts with an inline tag is a paragraph", () => {
  const md = [
    "<span>caption</span> [a](papers/a.pdf#page=2)",
    "[b](papers/a.pdf#page=3)",
    "",
    '<a href="x">anchor</a> [c](papers/a.pdf#page=4)',
  ].join("\n");
  assert.deepEqual(pagesOf(md), [2, 3, 4]);
});

test("HTML blocks still hide links until their end", () => {
  const md = [
    "<div>",
    "[hidden](papers/a.pdf#page=9)",
    "",
    "<span>",
    "[also hidden](papers/a.pdf#page=9)",
    "",
    "<pre>",
    "[raw](papers/a.pdf#page=9)",
    "",
    "[raw too](papers/a.pdf#page=9)",
    "</pre>",
    "[after](papers/a.pdf#page=2)",
  ].join("\n");
  assert.deepEqual(pagesOf(md), [2]);
});

test("a lone tag cannot interrupt a paragraph", () => {
  const md = "prose\n<br>\n[kept](papers/a.pdf#page=2)";
  assert.deepEqual(pagesOf(md), [2]);
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
