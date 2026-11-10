import assert from "node:assert/strict";
import test from "node:test";
import { revealRangesWithMatches } from "../../../src/markdown/search-reveal";

test("no matches leaves the caret reveal ranges untouched", () => {
  const reveal = [{ from: 3, to: 7 }];
  assert.deepEqual(revealRangesWithMatches(reveal, []), [{ from: 3, to: 7 }]);
});

test("a disjoint search match becomes its own reveal range", () => {
  assert.deepEqual(
    revealRangesWithMatches([{ from: 3, to: 7 }], [{ from: 20, to: 25 }]),
    [
      { from: 3, to: 7 },
      { from: 20, to: 25 },
    ],
  );
});

test("overlapping and adjacent ranges coalesce into one span", () => {
  assert.deepEqual(
    revealRangesWithMatches(
      [
        { from: 0, to: 5 },
        { from: 12, to: 18 },
      ],
      [
        { from: 4, to: 9 },
        { from: 9, to: 12 },
        { from: 30, to: 33 },
      ],
    ),
    [
      { from: 0, to: 18 },
      { from: 30, to: 33 },
    ],
  );
});

test("reversed and duplicate ranges are normalised", () => {
  assert.deepEqual(
    revealRangesWithMatches(
      [{ from: 10, to: 4 }],
      [
        { from: 4, to: 10 },
        { from: 5, to: 8 },
      ],
    ),
    [{ from: 4, to: 10 }],
  );
});

test("a run of adjacent matches collapses to one decoration span", () => {
  const matches = Array.from({ length: 100 }, (_, index) => ({
    from: index * 4,
    to: index * 4 + 4,
  }));
  assert.deepEqual(revealRangesWithMatches([], matches), [
    { from: 0, to: 400 },
  ]);
});
