import type { PageRef } from "@embedpdf/engine";
import type { PageRect } from "../shared/geometry";

/** Drags smaller than this (in points) are clicks, not regions. */
export const MIN_REGION_SIZE = 2;

/** A point on a page, in points from its top-left. */
interface Point {
  x: number;
  y: number;
}

/** A page's size in points. */
interface Size {
  width: number;
  height: number;
}

/** A region being dragged: the corner it began at, and where the pointer is. */
export interface RegionDrag {
  page: PageRef;
  from: Point;
  to: Point;
}

/** How a region gesture ended: a box was drawn, or it was a click. */
export type RegionEnd =
  { kind: "drawn"; page: PageRef; rect: PageRect } | { kind: "click" };

let drag: RegionDrag | undefined;
const dragListeners = new Set<() => void>();
const endListeners = new Set<(end: RegionEnd) => void>();

/** The region being dragged now, for the marquee drawn over its page. */
export function regionDrag(): RegionDrag | undefined {
  return drag;
}

export function onRegionDragChange(listener: () => void): () => void {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

/** Called when a region gesture ends; the selection tracker reports it. */
export function onRegionEnd(listener: (end: RegionEnd) => void): () => void {
  endListeners.add(listener);
  return () => {
    endListeners.delete(listener);
  };
}

function setDrag(next: RegionDrag | undefined): void {
  drag = next;
  for (const listener of dragListeners) {
    listener();
  }
}

/** A press on a page starts a region there. */
export function beginRegionDrag(page: PageRef, point: Point): void {
  setDrag({ page, from: point, to: point });
}

/**
 * The pointer moved. A drag keeps the page it began on and may leave it, so
 * the corner is held to that page's box.
 */
export function moveRegionDrag(point: Point, size: Size | undefined): void {
  if (drag) {
    setDrag({ ...drag, to: within(point, size) });
  }
}

/** The pointer was released: the region is drawn, or it was a click. */
export function endRegionDrag(point: Point, size: Size | undefined): void {
  const finished = drag;
  if (!finished) {
    return;
  }
  setDrag(undefined);
  const { from } = finished;
  const to = within(point, size);
  const rect: PageRect = [
    Math.min(from.x, to.x),
    Math.min(from.y, to.y),
    Math.max(from.x, to.x),
    Math.max(from.y, to.y),
  ];
  const isClick =
    rect[2] - rect[0] < MIN_REGION_SIZE || rect[3] - rect[1] < MIN_REGION_SIZE;
  const end: RegionEnd = isClick
    ? { kind: "click" }
    : { kind: "drawn", page: finished.page, rect };
  for (const listener of endListeners) {
    listener(end);
  }
}

/** Put the region down without drawing or clearing anything. */
export function cancelRegionDrag(): void {
  if (drag) {
    setDrag(undefined);
  }
}

function within(point: Point, size: Size | undefined): Point {
  if (!size) {
    return point;
  }
  return {
    x: Math.min(Math.max(point.x, 0), size.width),
    y: Math.min(Math.max(point.y, 0), size.height),
  };
}
