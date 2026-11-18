/**
 * Copy link puts the PDF's path and the quote into a Markdown link
 * destination. A space ends a CommonMark destination and a `)` ends it for
 * simple readers, so neither may appear raw, and every reader must give the
 * path and the quote back.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPdfBacklinks } from "../../src/shared/pdf-backlink-index";
import {
  localFragment,
  nativeLinks,
  readLinkDestination,
} from "../../src/shared/native-links";
import {
  encodeLinkPath,
  encodeTextFragment,
  formatPdfDeepLink,
  parsePdfDeepLinkFragment,
} from "../../src/shared/text-fragment";

const AWKWARD_PATH = "papers/my paper (v2) #1 100%.pdf";
const QUOTE = "a) first (b), then 'c' - d! *e*";

/** A note line linking `path` at page 3 and `text`, as a reader writes it. */
function linked(path: string, text: string): string {
  return `> [a.pdf · p.3](${formatPdfDeepLink(path, { page: 3, text })})`;
}

test("encodeTextFragment encodes the characters that would end a Markdown link or a directive", () => {
  assert.equal(
    encodeTextFragment("a) first"),
    ":~:text=a%29%20first",
    "a quote like `a) first` must not close [label](…) early",
  );
  assert.equal(
    encodeTextFragment("(x) y-z, w & v! 'q' *"),
    ":~:text=%28x%29%20y%2Dz%2C%20w%20%26%20v%21%20%27q%27%20%2A",
  );
  assert.doesNotMatch(encodeTextFragment(QUOTE), /[()\s,&'*!-]/u);
});

test("encodeLinkPath leaves ordinary paths alone and encodes what breaks a destination", () => {
  for (const path of [
    "papers/a.pdf",
    "论文/注意力.pdf",
    "a_b-c.d/e~f.pdf",
    "C:/Users/me/a.pdf",
  ]) {
    assert.equal(encodeLinkPath(path), path);
  }
  assert.equal(
    encodeLinkPath(AWKWARD_PATH),
    "papers/my%20paper%20%28v2%29%20%231%20100%25.pdf",
  );
  assert.equal(
    encodeLinkPath("a<b>|c\td\u00a0e.pdf"),
    "a%3Cb%3E%7Cc%09d%C2%A0e.pdf",
  );
  assert.equal(
    decodeURIComponent(encodeLinkPath(AWKWARD_PATH)),
    AWKWARD_PATH,
    "one decode gives the path back",
  );
});

test("a PDF with spaces and parentheses is one Markdown link whose path reads back", () => {
  const markdown = linked(AWKWARD_PATH, QUOTE);
  const links = nativeLinks(markdown);
  assert.equal(links.length, 1, markdown);
  const href = links[0]!.href;
  assert.doesNotMatch(href, /[\s<>]/u);
  assert.equal(href.split("(").length, href.split(")").length);
  assert.equal(href, formatPdfDeepLink(AWKWARD_PATH, { page: 3, text: QUOTE }));
  const parts = localFragment(href);
  assert.equal(parts?.path, AWKWARD_PATH);
  const parsed = parsePdfDeepLinkFragment(parts!.fragment);
  assert.equal(parsed.page, 3);
  assert.equal(parsed.textFragment?.textStart, QUOTE);
});

test("the backlink index finds the PDF, page and quote of an awkward deep link", () => {
  const hits = extractPdfBacklinks(
    linked(AWKWARD_PATH, QUOTE),
    "notes/n.md",
    "file:///notes/n.md",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.pdfKey, AWKWARD_PATH);
  assert.equal(hits[0]!.page, 3);
  assert.equal(hits[0]!.textFragment?.textStart, QUOTE);
});

test("a quote with a closing parenthesis does not end the link early", () => {
  const [hit] = extractPdfBacklinks(
    linked("papers/a.pdf", "a) first"),
    "n.md",
    "u",
  );
  assert.equal(hit?.textFragment?.textStart, "a) first");
});

test("the index reads both destination forms, parentheses and titles", () => {
  const note = [
    "[angle](<papers/my paper.pdf#page=2>)",
    "[encoded](papers/my%20paper.pdf#page=3)",
    "[balanced](papers/a(1).pdf#page=4)",
    String.raw`[escaped](papers/b\(2\).pdf#page=5)`,
    '[titled](papers/c.pdf#page=6 "A title")',
    "[spaced](  papers/d.pdf#page=7  )",
    "[unterminated](<papers/e.pdf#page=8)",
    "[not a pdf](papers/f.md#page=9)",
  ].join("\n");
  const hits = extractPdfBacklinks(note, "n.md", "u");
  assert.deepEqual(
    hits.map((hit) => [hit.pdfKey, hit.page]),
    [
      ["papers/my paper.pdf", 2],
      ["papers/my paper.pdf", 3],
      ["papers/a(1).pdf", 4],
      ["papers/b(2).pdf", 5],
      ["papers/c.pdf", 6],
      ["papers/d.pdf", 7],
    ],
  );
  assert.equal(hits[0]!.linkOffset, 0, "a hit points at its link's `[`");
  assert.equal(hits[1]!.linkOffset, note.indexOf("[encoded]"));
});

test("a link path is decoded once", () => {
  const [hit] = extractPdfBacklinks(
    "[x](papers/a%2520b.pdf#page=1) [y](papers/100%.pdf#page=1)",
    "n.md",
    "u",
  );
  assert.equal(hit?.pdfKey, "papers/a%20b.pdf");
  const hits = extractPdfBacklinks("[y](papers/100%.pdf#page=1)", "n.md", "u");
  assert.equal(hits[0]?.pdfKey, "papers/100%.pdf", "a stray % is kept");
});

test("readLinkDestination stops at the closing parenthesis and rejects a missing one", () => {
  assert.deepEqual(readLinkDestination("a(b).pdf#p=1) tail", 0), {
    from: 0,
    to: 12,
    href: "a(b).pdf#p=1",
  });
  assert.equal(readLinkDestination("a.pdf#p=1 and more", 0), undefined);
  assert.equal(readLinkDestination("<a b.pdf#p=1>)", 0)?.href, "a b.pdf#p=1");
});
