import assert from "node:assert/strict";
import { test } from "node:test";
import type { InteractionHostCapability } from "@embedpdf/plugin-interaction/contract/host";
import {
  beginRegionDrag,
  cancelRegionDrag,
  endRegionDrag,
  moveRegionDrag,
  onRegionDragChange,
  onRegionEnd,
  regionDrag,
  type RegionEnd,
} from "../../src/webview/region-drag";
import {
  REGION_TOOL_ID,
  registerRegionTools,
} from "../../src/webview/region-tool";

const page = { kind: "objectNumber" as const, objectNumber: 12 };
const size = { width: 100, height: 200 };

function ends(): { all: RegionEnd[]; stop: () => void } {
  const all: RegionEnd[] = [];
  return { all, stop: onRegionEnd((end) => all.push(end)) };
}

test("a drag draws the box between its corners, in either direction", () => {
  const seen = ends();
  beginRegionDrag(page, { x: 60, y: 90 });
  moveRegionDrag({ x: 20, y: 30 }, size);
  assert.deepEqual(regionDrag()?.to, { x: 20, y: 30 });
  endRegionDrag({ x: 20, y: 30 }, size);
  assert.equal(regionDrag(), undefined);
  assert.deepEqual(seen.all, [{ kind: "drawn", page, rect: [20, 30, 60, 90] }]);
  seen.stop();
});

test("a drag that leaves the page is held to its box", () => {
  const seen = ends();
  beginRegionDrag(page, { x: 60, y: 90 });
  moveRegionDrag({ x: 400, y: -50 }, size);
  assert.deepEqual(regionDrag()?.to, { x: 100, y: 0 });
  endRegionDrag({ x: 400, y: -50 }, size);
  assert.deepEqual(seen.all, [{ kind: "drawn", page, rect: [60, 0, 100, 90] }]);
  seen.stop();
});

test("a press that hardly moves is a click, which draws nothing", () => {
  const seen = ends();
  beginRegionDrag(page, { x: 10, y: 10 });
  endRegionDrag({ x: 11, y: 40 }, size);
  beginRegionDrag(page, { x: 10, y: 10 });
  endRegionDrag({ x: 10, y: 10 }, size);
  assert.deepEqual(seen.all, [{ kind: "click" }, { kind: "click" }]);
  seen.stop();
});

test("the box is announced while it is dragged, and gone when it ends or is cancelled", () => {
  let changes = 0;
  const stop = onRegionDragChange(() => changes++);
  beginRegionDrag(page, { x: 1, y: 1 });
  moveRegionDrag({ x: 30, y: 30 }, size);
  cancelRegionDrag();
  assert.equal(regionDrag(), undefined);
  cancelRegionDrag();
  assert.equal(changes, 3, "cancelling nothing announces nothing");
  stop();
});

test("a release with no region begun ends nothing", () => {
  const seen = ends();
  endRegionDrag({ x: 5, y: 5 }, size);
  assert.deepEqual(seen.all, []);
  seen.stop();
});

/** A hub that records what is registered on it. */
function fakeHub() {
  const tools = new Map<
    string,
    Record<string, (...args: never[]) => unknown>
  >();
  const handlers: { id: string; priority: number; [key: string]: unknown }[] =
    [];
  const hub = {
    registerTool: (tool: { id: string }) => {
      tools.set(tool.id, tool as never);
      return () => tools.delete(tool.id);
    },
    registerHandler: (handler: { id: string; priority: number }) => {
      handlers.push(handler);
      return () => handlers.splice(handlers.indexOf(handler), 1);
    },
  };
  return { hub: hub as unknown as InteractionHostCapability, tools, handlers };
}

test("the Select Region tool takes a press on a page and draws a region with it", () => {
  const { hub, tools } = fakeHub();
  const seen = ends();
  const remove = registerRegionTools(hub, () => size);
  const tool = tools.get(REGION_TOOL_ID) as unknown as {
    cursor: string;
    touch: string;
    enables: Set<string>;
    onPointerDown(event: unknown): boolean;
    onPointerMove(event: unknown): void;
    onPointerUp(event: unknown): void;
  };
  assert.equal(tool.cursor, "crosshair");
  assert.equal(tool.touch, "draw");
  assert.deepEqual([...tool.enables], ["link-nav"]);
  const at = (x: number, y: number) => ({ page, point: { x, y } });
  assert.equal(tool.onPointerDown(at(10, 20)), true);
  tool.onPointerMove(at(40, 60));
  tool.onPointerUp(at(40, 60));
  assert.deepEqual(seen.all, [{ kind: "drawn", page, rect: [10, 20, 40, 60] }]);
  remove();
  assert.equal(tools.size, 0, "taken off the hub again");
  seen.stop();
});

test("an empty-space drag while reading draws a region, below text selection", () => {
  const { hub, handlers } = fakeHub();
  const seen = ends();
  const remove = registerRegionTools(hub, () => size);
  const handler = handlers[0]! as unknown as {
    priority: number;
    enabledFor(tool: { id: string }): boolean;
    onPointerDown(sample: unknown): boolean;
    onPointerMove(sample: unknown): void;
    onPointerUp(sample: unknown): void;
  };
  assert.ok(handler.priority < 60, "the text selection handler goes first");
  assert.ok(handler.enabledFor({ id: "lumiere.read" }));
  assert.ok(!handler.enabledFor({ id: "lumiere.annotate" }));
  const sample = (x: number, y: number) => ({
    page: { ref: page, point: { x, y } },
    project: (ref: unknown) => (ref === page ? { x, y } : null),
  });
  assert.equal(handler.onPointerDown({ viewport: {} }), false, "off the pages");
  assert.equal(handler.onPointerDown(sample(5, 5)), true);
  handler.onPointerMove(sample(50, 80));
  handler.onPointerUp(sample(50, 80));
  assert.deepEqual(seen.all, [{ kind: "drawn", page, rect: [5, 5, 50, 80] }]);
  remove();
  assert.equal(handlers.length, 0);
  seen.stop();
});
