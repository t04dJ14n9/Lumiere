import assert from "node:assert/strict";
import { test } from "node:test";
import { lineRects } from "../../src/shared/line-rects";

test("glyph boxes become one box per line", () => {
  assert.deepEqual(
    lineRects([
      [72, 100, 80, 112],
      [80, 101, 88, 112],
      [72, 116, 80, 128],
      [80, 116, 90, 129],
    ]),
    [
      { x: 72, y: 100, w: 16, h: 12 },
      { x: 72, y: 116, w: 18, h: 13 },
    ],
  );
  assert.deepEqual(lineRects([]), []);
});
