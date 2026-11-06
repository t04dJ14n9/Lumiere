import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PdfActionType,
  PdfZoomMode,
  type PdfBookmarkObject,
  type PdfLinkTarget,
} from "@embedpdf/models";
import { outlineSections } from "../../src/shared/outline-sections";

const destination = (pageIndex: number): PdfLinkTarget => ({
  type: "destination",
  destination: { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view: [] },
});
const bookmark = (
  title: string,
  target?: PdfLinkTarget,
  children: PdfBookmarkObject[] = [],
): PdfBookmarkObject => ({ title, target, children });

test("bookmarks are flattened in document order with 1-based pages and their depth", () => {
  const outline = [
    bookmark("Part One", destination(0), [
      bookmark("Section 1.1", destination(1)),
      bookmark("Section 1.2", destination(2), [
        bookmark("Detail", destination(2)),
      ]),
    ]),
    bookmark("Part Two", destination(5)),
  ];
  assert.deepEqual(outlineSections(outline), [
    { title: "Part One", page: 1, depth: 0 },
    { title: "Section 1.1", page: 2, depth: 1 },
    { title: "Section 1.2", page: 3, depth: 1 },
    { title: "Detail", page: 3, depth: 2 },
    { title: "Part Two", page: 6, depth: 0 },
  ]);
});

test("a Go to action opens a page; other targets do not, but their children stay", () => {
  const outline = [
    bookmark("Chapter", {
      type: "action",
      action: {
        type: PdfActionType.Goto,
        destination: {
          pageIndex: 3,
          zoom: { mode: PdfZoomMode.Unknown },
          view: [],
        },
      },
    }),
    bookmark("Web", {
      type: "action",
      action: { type: PdfActionType.URI, uri: "https://example.com" },
    }),
    bookmark("Other file", {
      type: "action",
      action: {
        type: PdfActionType.RemoteGoto,
        destination: {
          pageIndex: 0,
          zoom: { mode: PdfZoomMode.Unknown },
          view: [],
        },
      },
    }),
    bookmark("Group only", undefined, [bookmark("Inside", destination(8))]),
  ];
  assert.deepEqual(outlineSections(outline), [
    { title: "Chapter", page: 4, depth: 0 },
    { title: "Inside", page: 9, depth: 1 },
  ]);
});

test("titles are one trimmed line and bookmarks without one are left out", () => {
  const outline = [
    bookmark("  Two\n lines\t here  ", destination(0)),
    bookmark("   ", destination(1)),
    bookmark("x".repeat(600), destination(2)),
  ];
  const sections = outlineSections(outline);
  assert.deepEqual(
    sections.map((section) => section.title.length),
    [14, 512],
  );
  assert.equal(sections[0]!.title, "Two lines here");
});

test("the list stops at the limit, children included", () => {
  const outline = [
    bookmark("A", destination(0), [
      bookmark("B", destination(1)),
      bookmark("C", destination(2)),
    ]),
    bookmark("D", destination(3)),
  ];
  assert.deepEqual(
    outlineSections(outline, 2).map((section) => section.title),
    ["A", "B"],
  );
  assert.deepEqual(outlineSections([]), []);
});
