import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_THUMBNAIL_WIDTH,
  THUMBNAIL_LABEL_HEIGHT,
  THUMBNAIL_PADDING,
  drawOrder,
  pageShape,
  thumbnailCellWidth,
  thumbnailLayout,
  thumbnailPixelWidth,
} from "../../src/shared/thumbnails";

test("a page turned a quarter has its sides swapped", () => {
  const size = { width: 300, height: 400 };
  assert.deepEqual(pageShape(size, 0), size);
  assert.deepEqual(pageShape(size, 180), size);
  assert.deepEqual(pageShape(size, 90), { width: 400, height: 300 });
  assert.deepEqual(pageShape(size, 270), { width: 400, height: 300 });
});

test("each page's cell is as high as its picture, with the page number under it", () => {
  const layout = thumbnailLayout(
    [
      { width: 300, height: 400 },
      { width: 400, height: 300 },
    ],
    150,
  );
  assert.deepEqual(layout.imageHeights, [200, 113]);
  const chrome = THUMBNAIL_PADDING * 2 + THUMBNAIL_LABEL_HEIGHT;
  assert.deepEqual(layout.offsets, [0, 200 + chrome, 200 + 113 + 2 * chrome]);
});

test("a page with no size, and a scroll of paper, still get a sane cell", () => {
  const layout = thumbnailLayout(
    [
      { width: 0, height: 0 },
      { width: 10, height: 1000 },
    ],
    100,
  );
  assert.deepEqual(layout.imageHeights, [141, 400]);
});

test("pictures are drawn at a multiple of 16 device pixels, so a dragged panel draws nothing again", () => {
  assert.equal(thumbnailPixelWidth(150, 1), 160);
  assert.equal(thumbnailPixelWidth(150, 2), 304);
  assert.equal(thumbnailPixelWidth(151, 1), 160);
  assert.equal(thumbnailPixelWidth(160, 1), 160);
  assert.equal(thumbnailPixelWidth(160.5, 1), 176);
  assert.equal(thumbnailPixelWidth(1, 0.5), 16);
});

test("a thumbnail is as wide as the panel leaves room for, up to a limit", () => {
  assert.equal(thumbnailCellWidth(240), 192);
  assert.equal(thumbnailCellWidth(200), 158);
  assert.equal(thumbnailCellWidth(640), MAX_THUMBNAIL_WIDTH);
  assert.equal(thumbnailCellWidth(10), 48);
});

test("pages are drawn nearest the middle of the view first", () => {
  assert.deepEqual(drawOrder({ first: 4, end: 9 }), [6, 5, 7, 4, 8]);
  assert.deepEqual(drawOrder({ first: 0, end: 4 }), [1, 2, 0, 3]);
  assert.deepEqual(drawOrder({ first: 3, end: 3 }), []);
});
