import assert from "node:assert/strict";
import test from "node:test";
import type { Axis } from "@workshop/scroll/axis-lock";
import {
  holdAcross,
  routeGesture,
  type OverflowOf,
  type Scroller,
} from "./scroll-route";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

type Node = Mutable<Scroller> & {
  name: string;
  overflow: Partial<Record<Axis, string>>;
  moves: unknown[];
};

function scroller(
  name: string,
  options: {
    parent?: Node;
    overflow?: Partial<Record<Axis, string>>;
    size?: { width: number; height: number };
    content?: { width: number; height: number };
    at?: { left: number; top: number };
  } = {},
): Node {
  const size = options.size ?? { width: 800, height: 600 };
  const content = options.content ?? size;
  const node: Node = {
    name,
    overflow: options.overflow ?? {},
    moves: [],
    parentElement: options.parent ?? null,
    clientWidth: size.width,
    clientHeight: size.height,
    scrollWidth: content.width,
    scrollHeight: content.height,
    scrollLeft: options.at?.left ?? 0,
    scrollTop: options.at?.top ?? 0,
    scrollBy(optionsOrX?: ScrollToOptions | number) {
      node.moves.push(optionsOrX);
      const by = optionsOrX as ScrollToOptions;
      node.scrollLeft += by.left ?? 0;
      node.scrollTop += by.top ?? 0;
    },
  };
  return node;
}

const overflowOf: OverflowOf = (element, axis) =>
  (element as Node).overflow[axis] ?? "visible";

/** A long note with a wide table and a code block in it, as the editor lays them out. */
function note(table: { left?: number } = {}) {
  const root = scroller("note", {
    overflow: { x: "auto", y: "auto" },
    content: { width: 800, height: 9000 },
    at: { left: 0, top: 3000 },
  });
  const content = scroller("content", { parent: root });
  const wide = scroller("table", {
    parent: content,
    overflow: { x: "auto", y: "hidden" },
    content: { width: 2000, height: 600 },
    at: { left: table.left ?? 0, top: 0 },
  });
  const cell = scroller("cell", { parent: wide });
  return { root, content, wide, cell };
}

function route(
  nodes: ReturnType<typeof note>,
  axis: Axis,
  direction: number,
  target: Node = nodes.cell,
) {
  return routeGesture({
    target,
    root: nodes.root,
    axis,
    direction,
    overflowOf,
  });
}

test("a vertical gesture over a wide table scrolls the note, not the table", () => {
  const nodes = note();
  const found = route(nodes, "y", 1);
  assert.equal((found.scroller as Node).name, "note");
});

test("a sideways gesture over a wide table scrolls the table, while it has room to go that way", () => {
  assert.equal(
    (route(note({ left: 0 }), "x", 1).scroller as Node).name,
    "table",
  );
  assert.equal(
    (route(note({ left: 600 }), "x", -1).scroller as Node).name,
    "table",
  );
  // At the table's edge the gesture falls through, to the note (which has no room either).
  assert.equal(
    (route(note({ left: 1200 }), "x", 1).scroller as Node).name,
    "note",
  );
  assert.equal(
    (route(note({ left: 0 }), "x", -1).scroller as Node).name,
    "note",
  );
});

test("a vertical gesture over a note that cannot scroll that way still lands on the note", () => {
  const nodes = note();
  nodes.root.scrollTop = 0;
  assert.equal((route(nodes, "y", -1).scroller as Node).name, "note");
  nodes.root.scrollTop = 8400;
  assert.equal((route(nodes, "y", 1).scroller as Node).name, "note");
});

test("only scrollers whose overflow lets the reader scroll count, and the nearest wins", () => {
  const nodes = note();
  nodes.wide.overflow.y = "visible";
  nodes.wide.scrollHeight = 5000;
  assert.equal((route(nodes, "y", 1).scroller as Node).name, "note");
  nodes.wide.overflow.y = "scroll";
  assert.equal((route(nodes, "y", 1).scroller as Node).name, "table");
  nodes.wide.overflow.y = "hidden";
  nodes.cell.overflow.y = "overlay";
  nodes.cell.scrollHeight = 5000;
  assert.equal((route(nodes, "y", 1).scroller as Node).name, "cell");
});

test("a gesture's target may be the note's own scroller, and nothing above it counts", () => {
  const above = scroller("above", {
    overflow: { y: "auto" },
    content: { width: 800, height: 9000 },
  });
  const nodes = note();
  nodes.root.parentElement = above;
  const found = route(nodes, "y", 1, nodes.root);
  assert.equal((found.scroller as Node).name, "note");
  assert.deepEqual(
    found.across.map((entry) => (entry.scroller as Node).name),
    [],
  );
});

test("the route remembers where each scroller that can move across the axis stood", () => {
  const nodes = note({ left: 40 });
  const found = route(nodes, "y", 1);
  assert.deepEqual(
    found.across.map((entry) => [(entry.scroller as Node).name, entry.offset]),
    [["table", 40]],
  );
  const sideways = route(nodes, "x", 1);
  assert.deepEqual(
    sideways.across.map((entry) => [
      (entry.scroller as Node).name,
      entry.offset,
    ]),
    [["note", 3000]],
  );
});

test("holding the route puts back what moved across the axis and leaves the rest", () => {
  const nodes = note({ left: 40 });
  const found = route(nodes, "y", 1);
  holdAcross(found, "y");
  assert.deepEqual(
    nodes.wide.moves,
    [],
    "nothing moved, so nothing is put back",
  );
  nodes.wide.scrollLeft = 46;
  nodes.root.scrollTop = 3500;
  holdAcross(found, "y");
  assert.equal(nodes.wide.scrollLeft, 40);
  assert.deepEqual(nodes.wide.moves, [{ left: -6, behavior: "instant" }]);
  assert.equal(nodes.root.scrollTop, 3500, "the axis it moves along is left");

  const sideways = route(nodes, "x", 1);
  nodes.root.scrollTop = 3003;
  holdAcross(sideways, "x");
  assert.equal(nodes.root.scrollTop, 3500);
});
