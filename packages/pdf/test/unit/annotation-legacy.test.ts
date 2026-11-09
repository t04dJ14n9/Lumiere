import assert from "node:assert/strict";
import { test } from "node:test";
import { planAnnotationImport } from "@embedpdf/engine-core/validation";
import { parseAnnotations } from "../../src/shared/annotation-store";

const box = (x: number, y: number, width: number, height: number) => ({
  origin: { x, y },
  size: { width, height },
});
const date = (iso: string) => ({ $date: iso });
const PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10];

/** What the version 1 file held for each tool Lumiere offered, as EmbedPDF 2 exported it. */
const OLD_ANNOTATIONS = [
  {
    id: "h",
    pageIndex: 0,
    type: 9,
    rect: box(10, 20, 80, 30),
    segmentRects: [box(10, 20, 30, 12), box(10, 34, 40, 12)],
    strokeColor: "#FFE566",
    color: "#FFE566",
    opacity: 0.3,
    blendMode: 1,
    author: "Lumiere",
    contents: "why",
    created: date("2026-11-08T10:00:00.000Z"),
    modified: date("2026-11-08T10:05:00.000Z"),
  },
  {
    id: "u",
    pageIndex: 1,
    type: 10,
    segmentRects: [box(1, 2, 30, 12)],
    strokeColor: "#E44234",
    opacity: 1,
  },
  {
    id: "s",
    pageIndex: 1,
    type: 12,
    segmentRects: [box(1, 2, 30, 12)],
    strokeColor: "#E44234",
    opacity: 1,
  },
  {
    id: "q",
    pageIndex: 1,
    type: 11,
    segmentRects: [box(1, 2, 30, 12)],
    strokeColor: "#E44234",
    opacity: 1,
  },
  {
    id: "n",
    pageIndex: 0,
    type: 1,
    rect: box(100, 100, 20, 20),
    contents: "note",
    strokeColor: "#FFCD45",
    opacity: 1,
    name: 0,
  },
  {
    id: "f",
    pageIndex: 0,
    type: 3,
    rect: box(50, 150, 180, 40),
    contents: "text",
    fontFamily: 4,
    fontSize: 14,
    fontColor: "#E44234",
    textAlign: 1,
    verticalAlign: 0,
    opacity: 1,
    color: "transparent",
  },
  {
    id: "i",
    pageIndex: 0,
    type: 15,
    rect: box(10, 10, 50, 20),
    inkList: [
      {
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 25 },
        ],
      },
    ],
    strokeColor: "#E44234",
    opacity: 1,
    strokeWidth: 6,
  },
  {
    id: "r",
    pageIndex: 0,
    type: 5,
    rect: box(10, 200, 80, 60),
    color: "transparent",
    opacity: 1,
    strokeWidth: 6,
    strokeColor: "#E44234",
    strokeStyle: 1,
  },
  {
    id: "c",
    pageIndex: 0,
    type: 6,
    rect: box(110, 200, 80, 60),
    color: "#FFFF00",
    opacity: 0.5,
    strokeWidth: 3,
    strokeColor: "#E44234",
    strokeStyle: 2,
    strokeDashArray: [4, 2],
  },
  {
    id: "l",
    pageIndex: 0,
    type: 4,
    rect: box(10, 300, 100, 20),
    linePoints: { start: { x: 10, y: 300 }, end: { x: 110, y: 320 } },
    lineEndings: { start: 0, end: 4 },
    color: "transparent",
    opacity: 1,
    strokeWidth: 6,
    strokeColor: "#E44234",
    strokeStyle: 1,
    intent: "LineArrow",
  },
  {
    id: "pg",
    pageIndex: 0,
    type: 7,
    rect: box(10, 330, 60, 50),
    vertices: [
      { x: 10, y: 330 },
      { x: 70, y: 340 },
      { x: 40, y: 380 },
    ],
    color: "transparent",
    opacity: 1,
    strokeWidth: 6,
    strokeColor: "#E44234",
    strokeStyle: 1,
  },
  {
    id: "pl",
    pageIndex: 0,
    type: 8,
    rect: box(100, 330, 60, 50),
    vertices: [
      { x: 100, y: 330 },
      { x: 160, y: 340 },
    ],
    color: "transparent",
    opacity: 1,
    strokeWidth: 6,
    strokeColor: "#E44234",
    strokeStyle: 1,
    lineEndings: { start: 0, end: 0 },
  },
  { id: "st", pageIndex: 2, type: 13, rect: box(10, 10, 60, 60) },
];

function oldFile(annotations: typeof OLD_ANNOTATIONS, extra: object[] = []) {
  const items = annotations.map((annotation) => ({
    annotation,
    ...(annotation.type === 13
      ? {
          ctx: {
            data: { $bytes: Buffer.from(PNG_BYTES).toString("base64") },
            mimeType: "image/png",
          },
        }
      : {}),
  }));
  return JSON.stringify({ version: 1, annotations: [...items, ...extra] });
}

test("an old file's annotations become a bundle EmbedPDF accepts as creates", async () => {
  const stored = (await parseAnnotations(oldFile(OLD_ANNOTATIONS)))!;
  assert.equal(stored.pages, "by-position");
  assert.equal(stored.skipped, 0);
  const { items } = stored.bundle;
  assert.equal(items.length, OLD_ANNOTATIONS.length);
  // The import's own check: each item is valid for its kind, none is left out.
  const plan = planAnnotationImport({
    bundle: stored.bundle,
    pages: "by-position",
    target: [0, 1, 2].map((position) => ({
      page: { kind: "objectNumber", objectNumber: 50 + position },
      position,
    })),
    nameTaken: () => false,
  });
  assert.equal(plan.creates.length, OLD_ANNOTATIONS.length);
  assert.deepEqual(plan.dropped, []);
  assert.deepEqual(
    plan.creates.map((create) => create.page.objectNumber),
    OLD_ANNOTATIONS.map((old) => 50 + old.pageIndex),
  );
});

test("a highlight keeps its lines, colour, blend, text, author and dates", async () => {
  const { bundle } = (await parseAnnotations(oldFile(OLD_ANNOTATIONS)))!;
  const highlight = bundle.items[0]!.data as unknown as Record<string, unknown>;
  assert.equal(highlight.subtype, "highlight");
  assert.deepEqual(highlight.quadPoints, [
    {
      upperLeft: { x: 10, y: 20 },
      upperRight: { x: 40, y: 20 },
      lowerLeft: { x: 10, y: 32 },
      lowerRight: { x: 40, y: 32 },
    },
    {
      upperLeft: { x: 10, y: 34 },
      upperRight: { x: 50, y: 34 },
      lowerLeft: { x: 10, y: 46 },
      lowerRight: { x: 50, y: 46 },
    },
  ]);
  assert.equal(highlight.color, "#FFE566");
  assert.equal(highlight.opacity, 0.3);
  assert.equal(highlight.blendMode, "multiply");
  assert.equal(highlight.contents, "why");
  assert.equal(highlight.author, "Lumiere");
  assert.equal(highlight.createdAt, "2026-11-08T10:00:00.000Z");
  assert.equal(highlight.modifiedAt, "2026-11-08T10:05:00.000Z");
  // The old id stays the annotation's name, so it keeps its identity.
  assert.equal(highlight.nm, "h");
});

test("a shape's colour was its fill, its strokeColor the outline", async () => {
  const { bundle } = (await parseAnnotations(oldFile(OLD_ANNOTATIONS)))!;
  const byName = (nm: string) =>
    bundle.items.find((item) => (item.data as { nm?: string }).nm === nm)!
      .data as unknown as Record<string, unknown>;
  const circle = byName("c");
  assert.equal(circle.color, "#E44234");
  assert.equal(circle.interiorColor, "#FFFF00");
  assert.equal(circle.borderStyle, "dashed");
  assert.deepEqual(circle.dashArray, [4, 2]);
  const square = byName("r");
  assert.equal(square.color, "#E44234");
  assert.equal("interiorColor" in square, false);
  assert.deepEqual(byName("l").lineEndings, {
    start: "none",
    end: "open-arrow",
  });
  assert.deepEqual(byName("i").inkList, [
    [
      { x: 10, y: 10 },
      { x: 30, y: 25 },
    ],
  ]);
});

test("a stamp's image becomes its drawing, named by its hash", async () => {
  const { bundle } = (await parseAnnotations(oldFile(OLD_ANNOTATIONS)))!;
  const stamp = bundle.items.at(-1)!;
  const id = stamp.resources.appearance!;
  assert.match(id, /^sha256-[0-9a-f]{64}$/u);
  assert.deepEqual([...bundle.resources[id]!], PNG_BYTES);
});

test("what cannot be converted is counted, not imported", async () => {
  const link = { annotation: { id: "k", pageIndex: 0, type: 2 } };
  const noLines = {
    annotation: { id: "m", pageIndex: 0, type: 9, segmentRects: [] },
  };
  const noImage = {
    annotation: { id: "p", pageIndex: 0, type: 13, rect: box(1, 1, 5, 5) },
  };
  const stored = (await parseAnnotations(
    oldFile(OLD_ANNOTATIONS.slice(0, 1), [link, noLines, noImage]),
  ))!;
  assert.equal(stored.bundle.items.length, 1);
  assert.equal(stored.skipped, 3);
});
