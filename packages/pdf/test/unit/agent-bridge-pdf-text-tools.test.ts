import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import type { AnnotationBundle } from "@embedpdf/engine-core/public";
import { serializeAnnotations } from "../../src/shared/annotation-store";
import { workspacePdfFiles } from "../../src/extension/outlines/vscode";
import { PdfTextReader } from "../../src/extension/pdf-text/reader";
import { findTextFragment } from "../../src/shared/pdf-backlink-resolve";
import { parsePdfDeepLinkFragment } from "../../src/shared/text-fragment";
import {
  MAX_MARKS,
  markEntry,
  marksOf,
} from "../../src/extension/plugins/agentBridge/mcp/tools/pdf-annotations";
import {
  findInPages,
  MAX_MATCHES,
} from "../../src/extension/plugins/agentBridge/mcp/tools/pdf-find";
import {
  MAX_CHARS,
  MAX_PAGES,
  takePages,
} from "../../src/extension/plugins/agentBridge/mcp/tools/pdf-page-text";
import {
  locateQuote,
  MAX_QUOTE_PAGES,
} from "../../src/extension/plugins/agentBridge/mcp/tools/pdf-quote";
import { callTool, fakeDeps, fakePanels } from "./support/bridge-tools";
import { bundle, refOn } from "./support/bundle";
import { fakeTextReader, type FakePdf } from "./support/pdf-text-fake";
import {
  installWorkspace,
  type WorkspaceFixture,
} from "./support/workspace-fixture";

/**
 * The tools that read a PDF's text: the pure parts (caps, matching, snippets,
 * links, the order of marks) and the tools through a real MCP client over a
 * real workspace folder, with a fake text reader. test/unit/pdf-text-engine
 * covers PDFium itself, and agent-bridge-pdf-text-real both together.
 */

/** Page 1 has CRLF line ends, as raw PDFium text may; page 3 is blank, as in a scan. */
const PAGES = [
  "Attention is all you need.\r\nThe Transformer\r\nrelies entirely on attention.",
  "Scaled dot-product ATTENTION\nis computed as softmax.",
  "",
  "attention appears here too, and attention again.",
];

let workspace: WorkspaceFixture;

beforeEach(async () => {
  workspace = await installWorkspace();
});
afterEach(async () => {
  vscode.workspace.fs.readFile = async () => new Uint8Array();
  await workspace.remove();
});

function depsWith(pdfs: Record<string, FakePdf>) {
  return fakeDeps({ text: fakeTextReader(pdfs).reader });
}

const textOf = (answer: { json(): unknown }) =>
  answer.json() as Record<string, unknown>;

// takePages

test("pages come back with their line breaks as \\n, clamped to the PDF's end", () => {
  assert.deepEqual(takePages(PAGES, 1, 2), {
    pages: [
      {
        page: 1,
        text: "Attention is all you need.\nThe Transformer\nrelies entirely on attention.",
      },
      { page: 2, text: PAGES[1] },
    ],
    truncated: false,
  });
  // Asking past the end is no truncation: the PDF simply ends.
  assert.deepEqual(takePages(PAGES, 4, 9), {
    pages: [{ page: 4, text: PAGES[3] }],
    truncated: false,
  });
});

test("a call returns at most 20 pages, and says which page to ask for next", () => {
  const many = Array.from({ length: 30 }, (_, n) => `page ${n + 1}`);
  const taken = takePages(many, 3, 30);
  assert.equal(taken.pages.length, MAX_PAGES);
  assert.equal(taken.pages[0]!.page, 3);
  assert.equal(taken.pages.at(-1)!.page, 22);
  assert.equal(taken.truncated, true);
  assert.equal(taken.nextPage, 23);
  // Exactly the cap is not a cut.
  assert.deepEqual(takePages(many, 1, MAX_PAGES).truncated, false);
});

test("a call returns at most about 50,000 characters: a later page that does not fit waits whole, the first is cut", () => {
  const big = "x".repeat(MAX_CHARS / 2 + 1);
  const taken = takePages([big, big, "tail"], 1, 3);
  assert.deepEqual(
    taken.pages.map(({ page }) => page),
    [1],
  );
  assert.equal(taken.truncated, true);
  assert.equal(taken.nextPage, 2);
  // One page longer than the whole budget is returned cut, and flagged.
  const huge = takePages(["y".repeat(MAX_CHARS + 500), "next"], 1, 2);
  assert.equal(huge.pages[0]!.text.length, MAX_CHARS);
  assert.equal(huge.pages[0]!.cut, true);
  assert.equal(huge.truncated, true);
  assert.equal(huge.nextPage, 2);
});

// findInPages

test("a text is found whatever its case and line breaks, with the page, in page order", () => {
  const found = findInPages(PAGES, "attention", 10);
  assert.equal(found.count, 5);
  assert.deepEqual(
    found.matches.map(({ page, text }) => [page, text]),
    [
      [1, "Attention"],
      [1, "attention"],
      [2, "ATTENTION"],
      [4, "attention"],
      [4, "attention"],
    ],
  );
  // A phrase that spans the CRLF in the page matches the query's single space.
  const phrase = findInPages(PAGES, "transformer  relies ENTIRELY", 10);
  assert.deepEqual(
    phrase.matches.map(({ page, text }) => [page, text]),
    [[1, "Transformer relies entirely"]],
  );
  assert.equal(findInPages(PAGES, "nothing like it", 10).count, 0);
  assert.deepEqual(findInPages(PAGES, "   ", 10), { count: 0, matches: [] });
});

test("every occurrence is counted, but only the first few are described", () => {
  const found = findInPages(PAGES, "attention", 2);
  assert.equal(found.count, 5);
  assert.equal(found.matches.length, 2);
  // Occurrences do not overlap.
  assert.equal(findInPages(["aaaa"], "aa", 10).count, 2);
  assert.equal(MAX_MATCHES, 50);
});

test("a snippet is one line of about 160 characters with the match in it, and ellipses where it is cut", () => {
  const long = `${"before ".repeat(40)}NEEDLE\r\n${"after ".repeat(40)}`;
  const [match] = findInPages([long], "needle", 1).matches;
  assert.ok(match!.snippet.startsWith("…"));
  assert.ok(match!.snippet.endsWith("…"));
  assert.ok(match!.snippet.includes("NEEDLE after"));
  assert.ok(!/[\r\n]/u.test(match!.snippet));
  assert.ok(
    match!.snippet.length >= 150 && match!.snippet.length <= 165,
    `${match!.snippet.length}`,
  );
  // A short page is its own snippet, with no ellipses.
  const [whole] = findInPages(
    ["tiny page\nwith one needle"],
    "needle",
    1,
  ).matches;
  assert.equal(whole!.snippet, "tiny page with one needle");
  // A match longer than the snippet is cut to it.
  const [wide] = findInPages(["w ".repeat(300)], "w ".repeat(200), 1).matches;
  assert.ok(wide!.snippet.length <= 162, `${wide!.snippet.length}`);
});

// locateQuote

test("a quote is located on every page that has it, at its first place, in the page's own words", () => {
  const found = locateQuote(PAGES, { textStart: "attention is all" });
  assert.deepEqual(found, [{ page: 1, text: "Attention is all" }]);
  const both = locateQuote(PAGES, { textStart: "attention" });
  assert.deepEqual(
    both.map(({ page }) => page),
    [1, 2, 4],
  );
  assert.deepEqual(locateQuote(PAGES, { textStart: "attention" }, 2), [
    { page: 2, text: "ATTENTION" },
  ]);
  assert.deepEqual(locateQuote(PAGES, { textStart: "attention" }, 3), []);
  assert.equal(MAX_QUOTE_PAGES, 10);
});

test("the words around a quote pick the one the agent means", () => {
  const found = locateQuote(PAGES, {
    textStart: "attention",
    prefix: "relies entirely on",
  });
  assert.deepEqual(found, [{ page: 1, text: "attention" }]);
  assert.deepEqual(
    locateQuote(PAGES, { textStart: "attention", suffix: "again" }).map(
      ({ page }) => page,
    ),
    [4],
  );
  // A passage that spans lines, with its end.
  assert.deepEqual(
    locateQuote(PAGES, {
      textStart: "the transformer",
      textEnd: "on attention",
    }),
    [{ page: 1, text: "The Transformer relies entirely on attention" }],
  );
});

// the tools

test("get_pdf_page_text answers with the PDF's name, page count and the pages' text, for a PDF that is not open", async () => {
  const deps = depsWith({ "papers/a.pdf": { pages: PAGES } });
  const answer = await callTool(deps, "get_pdf_page_text", {
    path: "papers/a.pdf",
    firstPage: 2,
    lastPage: 4,
  });
  assert.equal(answer.isError, false, answer.text);
  assert.deepEqual(answer.json(), {
    file: "papers/a.pdf",
    pageCount: 4,
    pages: [
      { page: 2, text: PAGES[1] },
      { page: 3, text: "" },
      { page: 4, text: PAGES[3] },
    ],
    truncated: false,
  });
  const single = await callTool(deps, "get_pdf_page_text", {
    path: "papers/a.pdf",
    firstPage: 1,
  });
  assert.equal(
    (textOf(single).pages as unknown[]).length,
    1,
    "lastPage defaults to firstPage",
  );
});

test("get_pdf_page_text refuses a page range that is not in the PDF, and says a scan has no text", async () => {
  const deps = depsWith({
    "papers/a.pdf": { pages: PAGES },
    "papers/b.pdf": { pages: ["", ""] },
  });
  const past = await callTool(deps, "get_pdf_page_text", {
    path: "papers/a.pdf",
    firstPage: 5,
  });
  assert.equal(past.isError, true);
  assert.match(
    past.text,
    /papers\/a\.pdf has 4 pages: firstPage 5 is past the end/u,
  );
  const backwards = await callTool(deps, "get_pdf_page_text", {
    path: "papers/a.pdf",
    firstPage: 3,
    lastPage: 2,
  });
  assert.equal(backwards.isError, true);
  assert.match(backwards.text, /lastPage is before firstPage/u);
  const scan = textOf(
    await callTool(deps, "get_pdf_page_text", {
      path: "papers/b.pdf",
      firstPage: 1,
    }),
  );
  assert.match(String(scan.note), /no text layer/u);
});

test("find_in_pdf returns page, snippet and a link for each match, with the total and a truncated flag", async () => {
  const deps = depsWith({ "papers/a.pdf": { pages: PAGES } });
  const answer = await callTool(deps, "find_in_pdf", {
    path: "papers/a.pdf",
    query: "ATTENTION",
    maxResults: 3,
  });
  assert.equal(answer.isError, false, answer.text);
  const json = textOf(answer) as {
    file: string;
    count: number;
    truncated: boolean;
    matches: { page: number; snippet: string; link: string }[];
  };
  assert.equal(json.file, "papers/a.pdf");
  assert.equal(json.count, 5);
  assert.equal(json.truncated, true);
  assert.deepEqual(
    json.matches.map(({ page }) => page),
    [1, 1, 2],
  );
  assert.equal(json.matches[2]!.link, "papers/a.pdf#page=2#:~:text=ATTENTION");
  assert.equal(
    json.matches[2]!.snippet,
    "Scaled dot-product ATTENTION is computed as softmax.",
  );
  const all = textOf(
    await callTool(deps, "find_in_pdf", {
      path: "papers/a.pdf",
      query: "softmax",
    }),
  );
  assert.equal(all.count, 1);
  assert.equal("truncated" in all, false);
});

test("find_in_pdf with nothing found says so, and a blank query or a scan is explained", async () => {
  const deps = depsWith({
    "papers/a.pdf": { pages: PAGES },
    "papers/b.pdf": { pages: ["", ""] },
  });
  const none = textOf(
    await callTool(deps, "find_in_pdf", {
      path: "papers/a.pdf",
      query: "zebra",
    }),
  );
  assert.deepEqual(none, { file: "papers/a.pdf", count: 0, matches: [] });
  const blank = await callTool(deps, "find_in_pdf", {
    path: "papers/a.pdf",
    query: "  \n ",
  });
  assert.equal(blank.isError, true);
  assert.match(blank.text, /blank/u);
  const scan = textOf(
    await callTool(deps, "find_in_pdf", {
      path: "papers/b.pdf",
      query: "x",
    }),
  );
  assert.match(String(scan.note), /no text layer/u);
  assert.equal(scan.count, 0);
});

test("every link the tools return resolves to its page when opened, by the matcher that reads links", async () => {
  const deps = depsWith({ "papers/a.pdf": { pages: PAGES } });
  const found = textOf(
    await callTool(deps, "find_in_pdf", {
      path: "papers/a.pdf",
      query: "transformer relies",
    }),
  ) as { matches: { page: number; link: string }[] };
  const located = textOf(
    await callTool(deps, "locate_pdf_quote", {
      path: "papers/a.pdf",
      quote: "scaled dot-product attention is",
    }),
  ) as { matches: { page: number; link: string }[] };
  const links = [...found.matches, ...located.matches];
  assert.equal(links.length, 2);
  for (const { page, link } of links) {
    const fragment = link.slice(link.indexOf("#") + 1);
    const parsed = parsePdfDeepLinkFragment(fragment);
    assert.equal(parsed.page, page, link);
    assert.ok(
      findTextFragment(PAGES[page - 1]!, parsed.textFragment!),
      `${link} finds its text on page ${page}`,
    );
  }
});

test("locate_pdf_quote lists the pages that match, says when it is ambiguous, and 'not found' is an answer, not an error", async () => {
  const deps = depsWith({ "papers/a.pdf": { pages: PAGES } });
  const one = textOf(
    await callTool(deps, "locate_pdf_quote", {
      path: "papers/a.pdf",
      quote: "The Transformer relies",
    }),
  );
  assert.deepEqual(one, {
    file: "papers/a.pdf",
    found: true,
    ambiguous: false,
    count: 1,
    matches: [
      {
        page: 1,
        text: "The Transformer relies",
        link: "papers/a.pdf#page=1#:~:text=The%20Transformer%20relies",
      },
    ],
  });
  const several = textOf(
    await callTool(deps, "locate_pdf_quote", {
      path: "papers/a.pdf",
      quote: "attention",
    }),
  );
  assert.equal(several.ambiguous, true);
  assert.equal(several.count, 3);
  const pinned = textOf(
    await callTool(deps, "locate_pdf_quote", {
      path: "papers/a.pdf",
      quote: "attention",
      page: 4,
    }),
  );
  assert.equal(pinned.ambiguous, false);
  const missing = await callTool(deps, "locate_pdf_quote", {
    path: "papers/a.pdf",
    quote: "a passage nobody wrote",
  });
  assert.equal(missing.isError, false);
  assert.deepEqual(missing.json(), {
    file: "papers/a.pdf",
    found: false,
    ambiguous: false,
    count: 0,
    matches: [],
  });
  const past = await callTool(deps, "locate_pdf_quote", {
    path: "papers/a.pdf",
    quote: "attention",
    page: 9,
  });
  assert.equal(past.isError, true);
  assert.match(past.text, /has 4 pages/u);
});

test("locate_pdf_quote lists at most 10 pages, and says when more match", async () => {
  const pages = Array.from({ length: 12 }, () => "the same sentence");
  const deps = depsWith({ "papers/a.pdf": { pages } });
  const answer = textOf(
    await callTool(deps, "locate_pdf_quote", {
      path: "papers/a.pdf",
      quote: "same sentence",
    }),
  );
  assert.equal(answer.count, 12);
  assert.equal((answer.matches as unknown[]).length, MAX_QUOTE_PAGES);
  assert.equal(answer.truncated, true);
});

test("a PDF the tools cannot read is refused with the reason, and a path outside the workspace like a missing file", async () => {
  const deps = depsWith({
    "papers/a.pdf": { opening: "locked" },
    ".raw/c.pdf": { opening: "copy-forbidden" },
  });
  const args = {
    get_pdf_page_text: { firstPage: 1 },
    find_in_pdf: { query: "x" },
    locate_pdf_quote: { quote: "x" },
  };
  for (const [tool, extra] of Object.entries(args)) {
    const locked = await callTool(deps, tool, {
      path: "papers/a.pdf",
      ...extra,
    });
    assert.equal(locked.isError, true, tool);
    assert.match(locked.text, /^papers\/a\.pdf needs a password/u, tool);
    const nocopy = await callTool(deps, tool, {
      path: ".raw/c.pdf",
      ...extra,
    });
    assert.match(nocopy.text, /^\.raw\/c\.pdf forbids copying/u, tool);
    // Inside the workspace but not known to the fake reader: missing.
    const gone = await callTool(deps, tool, { path: "papers/b.pdf", ...extra });
    assert.match(gone.text, /^papers\/b\.pdf is missing/u, tool);
    for (const path of [workspace.outside, "papers/escape.pdf", "../x.pdf"]) {
      const outside = await callTool(deps, tool, { path, ...extra });
      assert.equal(outside.isError, true, `${tool} ${path}`);
      assert.match(outside.text, /inside this window's workspace folders/u);
    }
    const none = await callTool(deps, tool, extra);
    assert.match(none.text, /No PDF has been viewed in Lumiere/u, tool);
  }
  const annotations = await callTool(deps, "list_pdf_annotations", {});
  assert.match(annotations.text, /No PDF has been viewed in Lumiere/u);
});

test("without a path the tools read the PDF the user viewed last, open or not", async () => {
  const panel = {
    uri: workspace.uri("papers/a.pdf"),
    view: { page: 1, pageCount: 4, zoomPercent: 100 },
    sha256: "ab".repeat(32),
  };
  const deps = fakeDeps({
    panels: fakePanels([panel], panel),
    text: fakeTextReader({ "papers/a.pdf": { pages: PAGES } }).reader,
  });
  const answer = textOf(
    await callTool(deps, "get_pdf_page_text", { firstPage: 4 }),
  );
  assert.equal(answer.file, "papers/a.pdf");
});

test("the PDF viewed last, when it is outside the workspace, is not read: its text is no more the agent's than a path outside would be", async () => {
  const panel = {
    uri: vscode.Uri.file(workspace.outside),
    view: { page: 1, pageCount: 1, zoomPercent: 100 },
    sha256: "cd".repeat(32),
  };
  const read: string[] = [];
  const reader = new PdfTextReader({
    files: workspacePdfFiles,
    engine: async () => ({
      pages: async (bytes) => {
        read.push(String(bytes.length));
        return { status: "ok", value: ["some text"] };
      },
      quotes: async () => ({ status: "ok", value: [] }),
      dispose: async () => {},
    }),
    log: () => {},
  });
  const deps = fakeDeps({ panels: fakePanels([panel], panel), text: reader });
  // The control: the same reader reads a PDF inside the workspace.
  const inside = await callTool(deps, "get_pdf_page_text", {
    path: "papers/a.pdf",
    firstPage: 1,
  });
  assert.equal(inside.isError, false, inside.text);
  assert.equal(read.length, 1);
  const args = {
    get_pdf_page_text: { firstPage: 1 },
    find_in_pdf: { query: "x" },
    locate_pdf_quote: { quote: "x" },
  };
  for (const [tool, extra] of Object.entries(args)) {
    const answer = await callTool(deps, tool, extra);
    assert.equal(answer.isError, true, tool);
    assert.match(
      answer.text,
      /is missing, or is not inside this window's workspace folders/u,
    );
  }
  assert.equal(read.length, 1, "the outside PDF was never read");
  reader.dispose();
});

test("the links the tools return open the PDF where open_pdf_location is told to", async () => {
  const deps = depsWith({ "papers/a.pdf": { pages: PAGES } });
  const find = textOf(
    await callTool(deps, "find_in_pdf", {
      path: "papers/a.pdf",
      query: "scaled dot-product",
    }),
  ) as { matches: { link: string }[] };
  const mark = markEntry(
    marksOf(marks([highlight(1, 9, box(72, 30, 100, 12))]))[0]!,
    undefined,
    "papers/a.pdf",
  );
  const links = [find.matches[0]!.link, mark.link];
  assert.deepEqual(links, [
    "papers/a.pdf#page=2#:~:text=Scaled%20dot%2Dproduct",
    "papers/a.pdf#page=3&viewrect=72,30,100,12",
  ]);
  const opened: unknown[][] = [];
  const executeCommand = vscode.commands.executeCommand;
  vscode.commands.executeCommand = (async (...args: unknown[]) => {
    opened.push(args);
    return true;
  }) as never;
  try {
    const answers = [];
    for (const link of links) {
      answers.push(await callTool(deps, "open_pdf_location", { link }));
    }
    assert.deepEqual(
      answers.map(({ text }) => text),
      ["Opened papers/a.pdf at page 2.", "Opened papers/a.pdf at page 3."],
    );
    assert.equal(opened.length, 2);
  } finally {
    vscode.commands.executeCommand = executeCommand;
  }
});

// list_pdf_annotations

const pageRef = (objectNumber: number) =>
  ({ kind: "objectNumber", objectNumber }) as const;
const box = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});
const quad = (left: number, top: number, right: number, bottom: number) => ({
  upperLeft: { x: left, y: top },
  upperRight: { x: right, y: top },
  lowerLeft: { x: left, y: bottom },
  lowerRight: { x: right, y: bottom },
});

/** Pages are objects 5 (page 1), 9 (page 3): marks name their page by object, the file maps it to a position. */
function marks(
  items: Parameters<typeof bundle>[0],
  positions: [objectNumber: number, position: number][] = [
    [5, 0],
    [9, 2],
  ],
): AnnotationBundle {
  return {
    ...bundle(items),
    pages: positions.map(([objectNumber, position]) => ({
      page: pageRef(objectNumber),
      position,
      size: { width: 300, height: 400 },
    })),
  } as unknown as AnnotationBundle;
}

const highlight = (
  objectNumber: number,
  onPage: number,
  rect: ReturnType<typeof box>,
  fields: Record<string, unknown> = {},
) => ({
  ref: refOn(objectNumber, onPage),
  subtype: "highlight",
  page: pageRef(onPage),
  rect,
  quadPoints: [quad(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)],
  color: "#ffe600",
  ...fields,
});

const SHA = "ab".repeat(32);

/** The file of marks the viewer would have saved for the PDF whose hash is SHA. */
function saveMarks(text: string | undefined): void {
  const file = workspace.uri(`.lumiere/pdf-annotations/${SHA}.json`).path;
  vscode.workspace.fs.readFile = (async (uri: vscode.Uri) => {
    if (uri.path === file && text !== undefined) {
      return new TextEncoder().encode(text);
    }
    throw vscode.FileSystemError.FileNotFound();
  }) as never;
}

function openDeps(pdf: FakePdf) {
  const panel = {
    uri: workspace.uri("papers/a.pdf"),
    view: { page: 1, pageCount: 4, zoomPercent: 100 },
    sha256: SHA,
  };
  const { reader, calls } = fakeTextReader({ "papers/a.pdf": pdf });
  return {
    deps: fakeDeps({ panels: fakePanels([panel], panel), text: reader }),
    calls,
  };
}

test("a mark's page is its position in the file, and marks come in reading order with only the reader's kinds", () => {
  const listed = marksOf(
    marks([
      highlight(3, 9, box(72, 30, 100, 12)),
      highlight(2, 5, box(72, 200, 100, 12)),
      highlight(1, 5, box(72, 50, 100, 12)),
      // Not the reader's to see: a link, and a mark on a page the file does not list.
      {
        ref: refOn(4, 5),
        subtype: "link",
        page: pageRef(5),
        rect: box(0, 0, 9, 9),
      },
      highlight(6, 77, box(0, 0, 9, 9)),
    ]),
  );
  assert.deepEqual(
    listed.map(({ row }) => [row.page, row.top, row.subtype]),
    [
      [1, 50, "highlight"],
      [1, 200, "highlight"],
      [3, 30, "highlight"],
    ],
  );
  assert.deepEqual(listed[0]!.boxes, [[72, 50, 172, 62]]);
  assert.deepEqual(listed[0]!.rect, {
    left: 72,
    top: 50,
    width: 100,
    height: 12,
  });
});

test("a mark links to the text it covers, or to its box when it covers none", () => {
  const [text, sticky] = marksOf(
    marks([
      highlight(1, 5, box(72, 50, 100, 12)),
      {
        ref: refOn(2, 5),
        subtype: "text",
        page: pageRef(5),
        rect: box(10, 300, 20, 20),
        contents: "  Check this\nagainst   table 2  ",
      },
    ]),
  ).map((mark) => mark);
  const withText = markEntry(
    text!,
    "Scaled dot-product\nattention",
    "papers/a.pdf",
  );
  assert.deepEqual(withText, {
    page: 1,
    kind: "highlight",
    color: "#ffe600",
    text: "Scaled dot-product attention",
    link: "papers/a.pdf#page=1#:~:text=Scaled%20dot%2Dproduct%20attention",
  });
  // No text read (the PDF's text was refused, or the mark has none): the box.
  assert.equal(
    markEntry(text!, undefined, "papers/a.pdf").link,
    "papers/a.pdf#page=1&viewrect=72,50,100,12",
  );
  assert.deepEqual(markEntry(sticky!, undefined, "papers/a.pdf"), {
    page: 1,
    kind: "text",
    note: "Check this against table 2",
    link: "papers/a.pdf#page=1&viewrect=10,300,20,20",
  });
  // Marked text is cut for the answer (120 characters), but not for the link's words.
  const long = "word ".repeat(60);
  const cut = markEntry(text!, long, "papers/a.pdf");
  assert.ok((cut.text as string).length <= 120);
  assert.ok((cut.text as string).endsWith("…"));
});

test("list_pdf_annotations lists the file's marks in reading order, with the text each covers read from the PDF", async () => {
  saveMarks(
    serializeAnnotations(
      marks([
        highlight(1, 9, box(72, 30, 100, 12), { contents: "see 2.1" }),
        highlight(2, 5, box(72, 100, 100, 12)),
        {
          ref: refOn(3, 5),
          subtype: "text",
          page: pageRef(5),
          rect: box(10, 300, 20, 20),
          contents: "a note",
        },
      ]),
    ),
  );
  const { deps, calls } = openDeps({
    pages: PAGES,
    quotes: (regions) => regions.map(({ page }) => `Text on page ${page}`),
  });
  const answer = await callTool(deps, "list_pdf_annotations", {
    path: "papers/a.pdf",
  });
  assert.equal(answer.isError, false, answer.text);
  assert.deepEqual(answer.json(), {
    file: "papers/a.pdf",
    sha256: SHA,
    count: 3,
    marks: [
      {
        page: 1,
        kind: "highlight",
        color: "#ffe600",
        text: "Text on page 1",
        link: "papers/a.pdf#page=1#:~:text=Text%20on%20page%201",
      },
      {
        page: 1,
        kind: "text",
        note: "a note",
        link: "papers/a.pdf#page=1&viewrect=10,300,20,20",
      },
      {
        page: 3,
        kind: "highlight",
        color: "#ffe600",
        text: "Text on page 3",
        note: "see 2.1",
        link: "papers/a.pdf#page=3#:~:text=Text%20on%20page%203",
      },
    ],
  });
  // One read of the PDF, for the two text marks only, in reading order.
  assert.equal(calls.quotes.length, 1);
  assert.deepEqual(
    calls.quotes[0]!.map(({ page }) => page),
    [1, 3],
  );
});

test("a PDF with no marks gives an empty list without starting PDFium; a damaged file is an error", async () => {
  const { deps, calls } = openDeps({ pages: PAGES });
  saveMarks(undefined);
  const none = await callTool(deps, "list_pdf_annotations", {});
  assert.deepEqual(none.json(), {
    file: "papers/a.pdf",
    sha256: SHA,
    count: 0,
    marks: [],
  });
  assert.equal(calls.quotes.length, 0);
  for (const damaged of ["not json", JSON.stringify({ version: 99 })]) {
    saveMarks(damaged);
    const answer = await callTool(deps, "list_pdf_annotations", {});
    assert.equal(answer.isError, true, damaged);
    assert.match(answer.text, /marks for papers\/a\.pdf could not be read/u);
  }
});

test("when the PDF's text cannot be read the marks are still listed, without it, and the answer says why", async () => {
  saveMarks(
    serializeAnnotations(marks([highlight(1, 5, box(72, 50, 100, 12))])),
  );
  const { deps } = openDeps({ opening: "copy-forbidden" });
  const answer = textOf(await callTool(deps, "list_pdf_annotations", {}));
  assert.equal(answer.count, 1);
  assert.deepEqual(
    (answer.marks as { link: string }[])[0]!.link,
    "papers/a.pdf#page=1&viewrect=72,50,100,12",
  );
  assert.match(
    String(answer.textNote),
    /marked text is not included.*forbids copying/iu,
  );
});

test("a PDF covered in marks lists the first 500, flagged", async () => {
  const items = Array.from({ length: MAX_MARKS + 3 }, (_, n) =>
    highlight(100 + n, 5, box(72, n, 100, 0.5)),
  );
  saveMarks(serializeAnnotations(marks(items)));
  const { deps } = openDeps({ pages: PAGES });
  const answer = textOf(await callTool(deps, "list_pdf_annotations", {}));
  assert.equal(answer.count, MAX_MARKS + 3);
  assert.equal((answer.marks as unknown[]).length, MAX_MARKS);
  assert.equal(answer.truncated, true);
});

test("a PDF that is not open is hashed to find its marks' file", async () => {
  const { reader } = fakeTextReader({ "papers/a.pdf": { pages: PAGES } });
  const bytes = new TextEncoder().encode("%PDF-1.4\nthe bytes\n%%EOF\n");
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const file = workspace.uri(`.lumiere/pdf-annotations/${sha}.json`).path;
  const pdf = workspace.uri("papers/a.pdf").path;
  vscode.workspace.fs.readFile = (async (uri: vscode.Uri) => {
    if (uri.path === pdf) {
      return bytes;
    }
    if (uri.path === file) {
      return new TextEncoder().encode(
        serializeAnnotations(marks([highlight(1, 5, box(72, 50, 100, 12))]))!,
      );
    }
    throw vscode.FileSystemError.FileNotFound();
  }) as never;
  const answer = textOf(
    await callTool(fakeDeps({ text: reader }), "list_pdf_annotations", {
      path: "papers/a.pdf",
    }),
  );
  assert.equal(answer.sha256, sha);
  assert.equal(answer.count, 1);
});

test("a listed mark says when it was made, when its file records it", () => {
  const [dated, undated] = marksOf(
    marks([
      highlight(1, 5, box(72, 50, 100, 12), {
        createdAt: "2026-11-20T07:29:25Z",
      }),
      highlight(2, 5, box(72, 200, 100, 12), { createdAt: null }),
    ]),
  );
  assert.equal(
    markEntry(dated!, undefined, "papers/a.pdf").created,
    "2026-11-20T07:29:25Z",
  );
  assert.equal(
    "created" in markEntry(undated!, undefined, "papers/a.pdf"),
    false,
  );
});
