import assert from "node:assert/strict";
import { test } from "node:test";
import { readingPlace, zoomChoice } from "../../src/webview/stage-position";

/** The part of the Stage the reading place reads. */
function stage(options: {
  destination: unknown;
  visible: { objectNumber: number; pageIndex: number }[];
  /** The page point at the viewer's corner, which may lie off the page. */
  corner?: { x: number; y: number };
}) {
  return {
    getCurrentDestination: () => options.destination,
    viewportToPage: () => options.corner ?? { x: 0, y: 0 },
    listVisiblePages: () =>
      options.visible.map(({ objectNumber, pageIndex }) => ({
        pageIndex,
        ref: { kind: "objectNumber", objectNumber },
      })),
  } as unknown as Parameters<typeof readingPlace>[0];
}

test("the reading place is the page at the corner, 1-based, and the point of it there", () => {
  const place = readingPlace(
    stage({
      // The Stage's destination is the point padding further in: not read.
      destination: {
        kind: "xyz",
        page: { kind: "objectNumber", objectNumber: 42 },
        x: 24.5,
        y: 352,
        zoom: null,
      },
      visible: [
        { objectNumber: 41, pageIndex: 3 },
        { objectNumber: 42, pageIndex: 4 },
      ],
      corner: { x: 12.5, y: 340.126 },
    }),
  );
  assert.deepEqual(place, { page: 5, top: 340.13, left: 12.5 });
});

test("the space around the first page is no point of it: the place there reads as the page's edge", () => {
  const page = { kind: "objectNumber", objectNumber: 7 };
  const place = readingPlace(
    stage({
      destination: { kind: "xyz", page, x: 0, y: 0, zoom: null },
      visible: [{ objectNumber: 7, pageIndex: 0 }],
      corner: { x: -12, y: -12 },
    }),
  );
  assert.deepEqual(place, { page: 1, top: 0, left: 0 });
});

test("there is no reading place before a page is on screen", () => {
  assert.equal(
    readingPlace(stage({ destination: null, visible: [] })),
    undefined,
  );
  const page = { kind: "objectNumber", objectNumber: 7 };
  assert.equal(
    readingPlace(
      stage({
        destination: { kind: "xyz", page, x: 0, y: 0, zoom: null },
        visible: [{ objectNumber: 8, pageIndex: 0 }],
      }),
    ),
    undefined,
    "a page the stage does not show",
  );
  assert.equal(
    readingPlace(
      stage({
        destination: { kind: "fit", page },
        visible: [{ objectNumber: 7, pageIndex: 0 }],
      }),
    ),
    undefined,
    "a destination that is not a point",
  );
});

test("a fit mode is the zoom choice while followed, else the level in percent", () => {
  const reads = (mode: string, level: number) =>
    ({
      getZoomMode: () => mode,
      getZoomLevel: () => level,
    }) as unknown as Parameters<typeof zoomChoice>[0];
  assert.equal(zoomChoice(reads("fit-width", 0.8)), "fitWidth");
  assert.equal(zoomChoice(reads("fit-page", 0.6)), "fitPage");
  assert.equal(zoomChoice(reads("custom", 1.25)), 125);
  assert.equal(zoomChoice(reads("automatic", 1)), 100);
  assert.equal(zoomChoice(reads("fit-all", 0.5)), 50);
});
