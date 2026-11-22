import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixedOffsets,
  scrollToShow,
  visibleRange,
} from "../../src/shared/list-window";

test("fixed offsets are the tops of the items and then the height of the list", () => {
  assert.deepEqual(fixedOffsets(3, 22), [0, 22, 44, 66]);
  assert.deepEqual(fixedOffsets(0, 22), [0]);
});

test("a view shows the items it overlaps", () => {
  const offsets = fixedOffsets(100, 22);
  assert.deepEqual(visibleRange(offsets, { top: 0, height: 66 }), {
    first: 0,
    end: 3,
  });
  // Starting part-way down an item includes it; ending exactly at an edge does not take the next.
  assert.deepEqual(visibleRange(offsets, { top: 30, height: 36 }), {
    first: 1,
    end: 3,
  });
  assert.deepEqual(visibleRange(offsets, { top: 2200 - 44, height: 400 }), {
    first: 98,
    end: 100,
  });
});

test("overscan adds items each side, within the list", () => {
  const offsets = fixedOffsets(100, 22);
  assert.deepEqual(visibleRange(offsets, { top: 220, height: 44 }, 3), {
    first: 7,
    end: 15,
  });
  assert.deepEqual(visibleRange(offsets, { top: 0, height: 22 }, 3), {
    first: 0,
    end: 4,
  });
});

test("an empty list, and a view of no height, draw at most the item at the top", () => {
  assert.deepEqual(visibleRange([0], { top: 0, height: 500 }), {
    first: 0,
    end: 0,
  });
  assert.deepEqual(visibleRange(fixedOffsets(10, 22), { top: 0, height: 0 }), {
    first: 0,
    end: 1,
  });
});

test("items of different heights are found by their offsets", () => {
  // Heights 100, 300, 50: tops 0, 100, 400; the list is 450 high.
  const offsets = [0, 100, 400, 450];
  assert.deepEqual(visibleRange(offsets, { top: 90, height: 20 }), {
    first: 0,
    end: 2,
  });
  assert.deepEqual(visibleRange(offsets, { top: 150, height: 100 }), {
    first: 1,
    end: 2,
  });
  assert.deepEqual(visibleRange(offsets, { top: 399, height: 100 }), {
    first: 1,
    end: 3,
  });
});

test("scrolling to an item moves the view by the least", () => {
  const offsets = fixedOffsets(100, 22);
  const view = { top: 220, height: 100 };
  // Already in view: nowhere to go.
  assert.equal(scrollToShow(offsets, 11, view), 220);
  // Above: line up at the top. Below: line up at the bottom.
  assert.equal(scrollToShow(offsets, 2, view), 44);
  assert.equal(scrollToShow(offsets, 20, view), 20 * 22 + 22 - 100);
  // Taller than the view: its top.
  assert.equal(scrollToShow([0, 300], 0, { top: 50, height: 100 }), 0);
  // An item the list does not have leaves the view.
  assert.equal(scrollToShow(offsets, 500, view), 220);
});
