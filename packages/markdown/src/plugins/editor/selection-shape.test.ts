import assert from "node:assert/strict";
import test from "node:test";
import {
  joinTouchingRuns,
  listIndentEnd,
  shapeSelection,
  type Box,
} from "./selection-shape";

const box = (left: number, top: number, width: number, height = 24): Box => ({
  left,
  top,
  width,
  height,
});

test("a line's text and its line-break stub join into one run", () => {
  assert.deepEqual(joinTouchingRuns([box(94, 0, 259.3), box(353.4, 0, 4)]), [
    box(94, 0, 263.4),
  ]);
});

test("runs apart on a row, or on different rows, stay apart", () => {
  const apart = [box(10, 0, 20), box(60, 0, 20)];
  assert.deepEqual(joinTouchingRuns(apart), apart);
  const stacked = [box(10, 24, 20), box(10, 0, 20)];
  assert.deepEqual(joinTouchingRuns(stacked), [
    box(10, 0, 20),
    box(10, 24, 20),
  ]);
});

test("a one-row selection rounds every corner", () => {
  assert.deepEqual(shapeSelection([box(10, 0, 100)])[0]!.square, []);
});

test("stacked rows round only the outline of the block", () => {
  // A selection starting mid-line, a full middle line, and a shorter end.
  const [first, middle, last] = shapeSelection([
    box(200, 0, 300),
    box(10, 24, 600),
    box(10, 48, 150),
  ]);
  assert.deepEqual(first!.square, ["bl", "br"]);
  assert.deepEqual(middle!.square, ["bl"]);
  assert.deepEqual(last!.square, ["tl", "tr"]);
});

test("a nested line inside the line above squares only its top corners", () => {
  const [parent, nested] = shapeSelection([box(83, 0, 380), box(129, 24, 300)]);
  assert.deepEqual(parent!.square, []);
  assert.deepEqual(nested!.square, ["tl", "tr"]);
});

test("rows separated by a gap (a heading's padding) round on their own", () => {
  const shaped = shapeSelection([box(10, 0, 100), box(10, 40, 100)]);
  assert.deepEqual(
    shaped.map((part) => part.square),
    [[], []],
  );
});

test("a neighbour that only grazes a corner leaves it rounded", () => {
  // The row below starts 2 px before this row's right edge: under a radius.
  const [upper] = shapeSelection([box(10, 0, 100), box(108, 24, 50)]);
  assert.deepEqual(upper!.square, []);
});

test("a list line's tint starts at its marker, after the indentation", () => {
  assert.equal(listIndentEnd("- top"), 0);
  assert.equal(listIndentEnd("    - nested"), 4);
  assert.equal(listIndentEnd("\t\t* tabs"), 2);
  assert.equal(listIndentEnd("  12. ordered"), 2);
  assert.equal(listIndentEnd("  3) ordered"), 2);
  assert.equal(listIndentEnd("    - [ ] task"), 4);
  assert.equal(listIndentEnd("    -"), 4);
});

test("lines that are not list items keep their leading whitespace tinted", () => {
  assert.equal(listIndentEnd("    code indented"), 0);
  assert.equal(listIndentEnd("  -not a marker"), 0);
  assert.equal(listIndentEnd("    ---"), 0);
  assert.equal(listIndentEnd("paragraph"), 0);
});
