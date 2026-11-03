import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMBEDDED_CLICK_SELECT_TYPES,
  findEmbeddedSelectHit,
  isEmbeddedClickSelectType,
} from "../../src/shared/embedded-hit";

test("only text-markup subtypes are click-select targets for Annotate", () => {
  assert.equal(isEmbeddedClickSelectType(9), true); // HIGHLIGHT
  assert.equal(isEmbeddedClickSelectType(10), true); // UNDERLINE
  assert.equal(isEmbeddedClickSelectType(11), true); // SQUIGGLY
  assert.equal(isEmbeddedClickSelectType(12), true); // STRIKEOUT
  assert.equal(isEmbeddedClickSelectType(15), false); // INK
  assert.equal(isEmbeddedClickSelectType(13), false); // STAMP
  assert.equal(isEmbeddedClickSelectType(5), false); // SQUARE
  assert.equal(isEmbeddedClickSelectType(undefined), false);
  assert.ok(EMBEDDED_CLICK_SELECT_TYPES.has(9));
});

test("findEmbeddedSelectHit ignores ink/stamp large rects that would steal Highlight clicks", () => {
  const ink = {
    object: {
      id: "ink-1",
      pageIndex: 0,
      type: 15,
      rect: {
        origin: { x: 0, y: 0 },
        size: { width: 400, height: 400 },
      },
    },
  };
  const highlight = {
    object: {
      id: "hl-1",
      pageIndex: 0,
      type: 9,
      segmentRects: [
        { origin: { x: 70, y: 90 }, size: { width: 60, height: 14 } },
      ],
    },
  };
  // Ink covers the page; without a type filter it would win. With filter, miss.
  assert.equal(
    findEmbeddedSelectHit([ink], { pageIndex: 0, px: 100, py: 94 }),
    undefined,
  );
  assert.deepEqual(
    findEmbeddedSelectHit([ink, highlight], { pageIndex: 0, px: 100, py: 94 }),
    { pageIndex: 0, id: "hl-1" },
  );
  // Underline still selectable (Delete path).
  const underline = {
    object: {
      id: "ul-1",
      pageIndex: 0,
      type: 10,
      segmentRects: [
        { origin: { x: 70, y: 90 }, size: { width: 60, height: 14 } },
      ],
    },
  };
  assert.deepEqual(
    findEmbeddedSelectHit([underline], { pageIndex: 0, px: 100, py: 94 }),
    { pageIndex: 0, id: "ul-1" },
  );
});
