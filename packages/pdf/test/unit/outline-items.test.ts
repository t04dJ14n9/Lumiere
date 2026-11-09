import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutlineItem } from "@embedpdf/engine";
import { sectionsOfOutline } from "../../src/extension/outlines/outline-items";

// Page k is the dictionary with object number 10 + k, and sits at index k.
const pages = [0, 1, 2, 3].map((index) => ({
  index,
  ref: { kind: "objectNumber" as const, objectNumber: 10 + index },
}));

let nextObject = 100;
function item(
  title: string,
  target: OutlineItem["target"],
  parent: OutlineItem | null = null,
): OutlineItem {
  return {
    ref: { kind: "objectNumber", objectNumber: nextObject++ },
    parent: parent?.ref ?? null,
    title,
    target,
    action: null,
    open: false,
    color: null,
    bold: false,
    italic: false,
  };
}
const goTo = (pageIndex: number): OutlineItem["target"] => ({
  kind: "goto",
  destination: { kind: "fit", page: pages[pageIndex]!.ref },
});

test("items come back in order with 1-based pages and a depth counted from their parents", () => {
  const partOne = item("Part One", goTo(0));
  const section = item("Section 1.1", goTo(1), partOne);
  const detail = item("Detail", goTo(1), section);
  const partTwo = item("Part Two", goTo(3));
  assert.deepEqual(
    sectionsOfOutline([partOne, section, detail, partTwo], pages),
    [
      { title: "Part One", page: 1, depth: 0 },
      { title: "Section 1.1", page: 2, depth: 1 },
      { title: "Detail", page: 2, depth: 2 },
      { title: "Part Two", page: 4, depth: 0 },
    ],
  );
});

test("an item that opens no page of the PDF is left out, but its children stay at their depth", () => {
  const web = item("Web", { kind: "uri", uri: "https://example.com" });
  const group = item("Group only", null);
  const gone = item("Removed page", {
    kind: "goto",
    destination: {
      kind: "fit",
      page: { kind: "objectNumber", objectNumber: 1 },
    },
  });
  const inside = item("Inside", goTo(2), group);
  assert.deepEqual(sectionsOfOutline([web, group, gone, inside], pages), [
    { title: "Inside", page: 3, depth: 1 },
  ]);
});

test("titles are one trimmed line and items without one are left out", () => {
  const sections = sectionsOfOutline(
    [
      item("  Two\n lines\t here  ", goTo(0)),
      item("   ", goTo(1)),
      item("x".repeat(600), goTo(2)),
    ],
    pages,
  );
  assert.deepEqual(
    sections.map((section) => section.title.length),
    [14, 512],
  );
  assert.equal(sections[0]!.title, "Two lines here");
});

test("the list stops at the limit, children included", () => {
  const first = item("A", goTo(0));
  const items = [
    first,
    item("B", goTo(1), first),
    item("C", goTo(2), first),
    item("D", goTo(3)),
  ];
  assert.deepEqual(
    sectionsOfOutline(items, pages, 2).map((section) => section.title),
    ["A", "B"],
  );
  assert.deepEqual(sectionsOfOutline([], pages), []);
});
