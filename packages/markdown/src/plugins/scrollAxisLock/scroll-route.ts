import type { Axis } from "@workshop/scroll/axis-lock";

/** The parts of an element a route reads and moves; an `HTMLElement` satisfies it. */
export interface Scroller extends Pick<
  HTMLElement,
  | "scrollLeft"
  | "scrollTop"
  | "scrollWidth"
  | "scrollHeight"
  | "clientWidth"
  | "clientHeight"
  | "scrollBy"
> {
  readonly parentElement: Scroller | null;
}

/** An element's `overflow-x` or `overflow-y` value. */
export type OverflowOf = (element: Scroller, axis: Axis) => string;

/** Where a gesture locked to an axis scrolls, and what must not move while it does. */
export interface ScrollRoute {
  /** The element that takes the gesture's movement along its axis. */
  readonly scroller: Scroller;
  /**
   * Every scroller from the pointer up that can move across the axis, as it
   * stood when the gesture locked: the first events of a gesture reach the
   * browser before the lock is known, and one of these latched them.
   */
  readonly across: readonly { scroller: Scroller; offset: number }[];
}

const SCROLLABLE = new Set(["auto", "scroll", "overlay"]);

/** Browsers round scroll positions to device pixels. */
const EDGE_TOLERANCE = 0.5;

export function computedOverflow(element: Scroller, axis: Axis): string {
  const style = getComputedStyle(element as unknown as Element);
  return axis === "x" ? style.overflowX : style.overflowY;
}

function range(element: Scroller, axis: Axis): number {
  return axis === "x"
    ? element.scrollWidth - element.clientWidth
    : element.scrollHeight - element.clientHeight;
}

function position(element: Scroller, axis: Axis): number {
  return axis === "x" ? element.scrollLeft : element.scrollTop;
}

/** Whether the element scrolls along the axis, with room to go in the direction. */
function hasRoom(
  element: Scroller,
  axis: Axis,
  direction: number,
  overflowOf: OverflowOf,
): boolean {
  const room = range(element, axis);
  if (room <= EDGE_TOLERANCE || !SCROLLABLE.has(overflowOf(element, axis))) {
    return false;
  }
  const at = position(element, axis);
  return direction > 0 ? at < room - EDGE_TOLERANCE : at > EDGE_TOLERANCE;
}

/**
 * Where a gesture locked to `axis`, moving in `direction` (its sign), scrolls
 * when it began at `target`: the nearest scroller at or above the target that
 * can scroll that way, as the browser would choose, else the note's own
 * (whose edge then stops it, as the browser's would). `root` is the note's.
 */
export function routeGesture(options: {
  target: Scroller;
  root: Scroller;
  axis: Axis;
  direction: number;
  overflowOf?: OverflowOf;
}): ScrollRoute {
  const { target, root, axis, direction } = options;
  const overflowOf = options.overflowOf ?? computedOverflow;
  const crossAxis: Axis = axis === "x" ? "y" : "x";
  let scroller: Scroller | null = null;
  const across: { scroller: Scroller; offset: number }[] = [];
  for (let node: Scroller | null = target; node; node = node.parentElement) {
    if (scroller === null && hasRoom(node, axis, direction, overflowOf)) {
      scroller = node;
    }
    if (range(node, crossAxis) > EDGE_TOLERANCE) {
      across.push({ scroller: node, offset: position(node, crossAxis) });
    }
    if (node === root) {
      break;
    }
  }
  return { scroller: scroller ?? root, across };
}

/** Put every scroller of the route back where it stood on the axis the gesture does not move. */
export function holdAcross(route: ScrollRoute, axis: Axis): void {
  const crossAxis: Axis = axis === "x" ? "y" : "x";
  for (const { scroller, offset } of route.across) {
    if (position(scroller, crossAxis) !== offset) {
      scroller.scrollBy(
        crossAxis === "x"
          ? { left: offset - scroller.scrollLeft, behavior: "instant" }
          : { top: offset - scroller.scrollTop, behavior: "instant" },
      );
    }
  }
}
