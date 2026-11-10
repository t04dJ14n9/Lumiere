import assert from "node:assert/strict";
import { test } from "node:test";
import { READ_TOOL_ID } from "../../src/shared/annotation-tools";
import { pagedDragPageDelta } from "../../src/shared/paged-drag-navigate";
import { readTool } from "../../src/webview/annotation-mode";
import { pagedDragHandler } from "../../src/webview/paged-drag-navigate";
import type { PointerSample } from "@embedpdf/plugin-interaction/contract/host";

const page = { kind: "objectNumber" as const, objectNumber: 1 };

function sample(x: number, y: number, onPage = true): PointerSample {
  return {
    phase: "down",
    viewport: { x, y },
    ...(onPage ? { page: { ref: page, point: { x, y } } } : {}),
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

test("an upward blank drag in page-by-page mode turns to the next page", () => {
  // Matches the failed Host GUI swipe: (900, 620) -> (900, 180) stayed on page 1.
  assert.equal(
    pagedDragPageDelta({ x: 900, y: 620 }, { x: 900, y: 180 }, "vertical"),
    1,
  );
  const steps: Array<1 | -1> = [];
  const handler = pagedDragHandler({
    isPaged: () => true,
    direction: () => "vertical",
    step: (delta) => steps.push(delta),
  });
  assert.ok(handler.priority > 10, "above Stage's pan handler");
  assert.ok(handler.priority < 56, "below text selection and the region tool");
  assert.ok(handler.enabledFor(readTool()));
  assert.ok(
    !handler.enabledFor({
      id: "pointer",
      cursor: "default",
      enables: new Set(),
    }),
  );
  assert.equal(handler.onPointerDown(sample(900, 620)), true);
  handler.onPointerMove?.(sample(900, 180));
  handler.onPointerUp?.(sample(900, 180));
  assert.deepEqual(steps, [1]);
});

test("an edge-to-edge upward drag also turns, even when it could have panned first", () => {
  assert.equal(
    pagedDragPageDelta({ x: 900, y: 730 }, { x: 900, y: 80 }, "vertical"),
    1,
  );
  const steps: Array<1 | -1> = [];
  const handler = pagedDragHandler({
    isPaged: () => true,
    direction: () => "vertical",
    step: (delta) => steps.push(delta),
  });
  handler.onPointerDown(sample(900, 730));
  handler.onPointerUp?.(sample(900, 80));
  assert.deepEqual(steps, [1]);
});

test("a downward drag turns to the previous page; a short drag does not turn", () => {
  assert.equal(
    pagedDragPageDelta({ x: 900, y: 180 }, { x: 900, y: 620 }, "vertical"),
    -1,
  );
  assert.equal(
    pagedDragPageDelta({ x: 900, y: 200 }, { x: 900, y: 210 }, "vertical"),
    0,
  );
  const steps: Array<1 | -1> = [];
  const handler = pagedDragHandler({
    isPaged: () => true,
    direction: () => "vertical",
    step: (delta) => steps.push(delta),
  });
  handler.onPointerDown(sample(900, 200));
  handler.onPointerUp?.(sample(900, 210));
  assert.deepEqual(steps, []);
  handler.onPointerDown(sample(900, 180));
  handler.onPointerUp?.(sample(900, 620));
  assert.deepEqual(steps, [-1]);
});

test("continuous scrolling does not capture a blank drag (Stage pan keeps it)", () => {
  const handler = pagedDragHandler({
    isPaged: () => false,
    direction: () => "vertical",
    step: () => {
      throw new Error("must not step");
    },
  });
  assert.equal(handler.enabledFor(readTool()), false);
});

test("a press off the page is left to Stage gap pan", () => {
  const handler = pagedDragHandler({
    isPaged: () => true,
    direction: () => "vertical",
    step: () => {
      throw new Error("must not step");
    },
  });
  assert.equal(handler.onPointerDown(sample(900, 620, false)), false);
});

test("a horizontal drag turns along the reading direction", () => {
  assert.equal(
    pagedDragPageDelta({ x: 700, y: 400 }, { x: 200, y: 400 }, "horizontal"),
    1,
  );
  assert.equal(
    pagedDragPageDelta({ x: 200, y: 400 }, { x: 700, y: 400 }, "horizontal"),
    -1,
  );
});

test("the read tool still enables pan so continuous blank-area drag can scroll", () => {
  assert.ok(readTool().enables.has("scroll"));
  assert.equal(readTool().id, READ_TOOL_ID);
});
