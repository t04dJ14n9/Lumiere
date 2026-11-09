import assert from "node:assert/strict";
import { test } from "node:test";
import type { PdfLinkTarget } from "@embedpdf/engine-core/runtime";
import {
  targetDestination,
  targetPage,
  targetTop,
  targetUrl,
} from "../../src/shared/pdf-link-target";
import { toOutline } from "../../src/webview/pdf-targets";

/** Page k is the page dictionary with object number 10 + k, at position k. */
const ref = (index: number) => ({
  kind: "objectNumber" as const,
  objectNumber: 10 + index,
});
const numberOf = (page: { objectNumber: number }) =>
  page.objectNumber >= 10 && page.objectNumber < 20
    ? page.objectNumber - 9
    : undefined;

const xyz = (index: number, y: number | null): PdfLinkTarget => ({
  kind: "goto",
  destination: { kind: "xyz", page: ref(index), x: null, y, zoom: null },
});

test("a Go To names its page by identity, which the document turns into a 1-based number", () => {
  assert.equal(targetPage(xyz(4, 100), numberOf), 5);
  assert.equal(targetPage(xyz(0, null), numberOf), 1);
  assert.deepEqual(targetDestination(xyz(2, 5))?.page, ref(2));
});

test("a page the document no longer has opens nothing", () => {
  assert.equal(targetPage(xyz(40, 100), numberOf), undefined);
});

test("targets that are not a place in the PDF have no page", () => {
  const targets: (PdfLinkTarget | null | undefined)[] = [
    { kind: "uri", uri: "https://example.com" },
    { kind: "goto-remote", file: "other.pdf" },
    { kind: "launch", path: "app" },
    { kind: "named", name: "NextPage" },
    { kind: "javascript" },
    { kind: "unsupported" },
    null,
    undefined,
  ];
  for (const target of targets) {
    assert.equal(targetPage(target, numberOf), undefined);
    assert.equal(targetTop(target), undefined);
  }
});

test("how far down a page a target opens is its height from the top, when it names one", () => {
  assert.equal(targetTop(xyz(1, 130)), 130);
  assert.equal(targetTop(xyz(1, 0)), 0, "the very top is a height");
  assert.equal(targetTop(xyz(1, null)), undefined, "unset: the page's top");
  assert.equal(targetTop(xyz(1, -12)), 0, "above the page opens at its top");
  const fitH: PdfLinkTarget = {
    kind: "goto",
    destination: { kind: "fitH", page: ref(1), y: 72 },
  };
  assert.equal(targetTop(fitH), 72);
  const fitBH: PdfLinkTarget = {
    kind: "goto",
    destination: { kind: "fitBH", page: ref(1), y: 90 },
  };
  assert.equal(targetTop(fitBH), 90);
});

test("destinations that fit a whole page, or name a side or a box, open the page's top", () => {
  const destinations = [
    { kind: "fit", page: ref(1) },
    { kind: "fitV", page: ref(1), x: 10 },
    { kind: "fitR", page: ref(1), x: 1, y: 2, width: 3, height: 4 },
    { kind: "fitB", page: ref(1) },
    { kind: "fitBV", page: ref(1), x: 10 },
  ] as const;
  for (const destination of destinations) {
    assert.equal(targetTop({ kind: "goto", destination }), undefined);
  }
});

test("only a URI target has a web address", () => {
  assert.equal(
    targetUrl({ kind: "uri", uri: "https://example.com/paper" }),
    "https://example.com/paper",
  );
  assert.equal(targetUrl(xyz(1, 5)), undefined);
  assert.equal(targetUrl(null), undefined);
});

test("an outline read flat becomes the tree the extension shows, with pages and heights", () => {
  const item = (
    objectNumber: number,
    title: string,
    parent: number | null,
    target: PdfLinkTarget | null,
  ) => ({
    ref: { kind: "objectNumber" as const, objectNumber },
    parent:
      parent === null
        ? null
        : { kind: "objectNumber" as const, objectNumber: parent },
    title,
    target,
    action: null,
    open: false,
    color: null,
    bold: false,
    italic: false,
  });
  const outline = toOutline(
    [
      item(100, "Part One", null, xyz(0, null)),
      item(101, "Section 1.1", 100, xyz(1, 130)),
      item(102, "Detail", 101, xyz(1, 200)),
      item(103, "Web", null, { kind: "uri", uri: "https://example.com" }),
      item(104, "Group", null, null),
      item(105, "Inside", 104, xyz(7, null)),
    ],
    numberOf,
  );
  assert.deepEqual(outline, [
    {
      title: "Part One",
      page: 1,
      children: [
        {
          title: "Section 1.1",
          page: 2,
          top: 130,
          children: [{ title: "Detail", page: 2, top: 200, children: [] }],
        },
      ],
    },
    { title: "Web", children: [] },
    { title: "Group", children: [{ title: "Inside", page: 8, children: [] }] },
  ]);
});
