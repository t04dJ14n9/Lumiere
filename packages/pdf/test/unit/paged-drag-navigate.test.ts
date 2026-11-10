import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventHook } from "@embedpdf/core";
import {
  INTERACTION_DEFAULTS,
  interactionPlugin,
} from "@embedpdf/plugin-interaction";
import type {
  InteractionHostCapability,
  PointerSample,
} from "@embedpdf/plugin-interaction/contract/host";
import { READ_TOOL_ID } from "../../src/shared/annotation-tools";
import { pagedDragPageDelta } from "../../src/shared/paged-drag-navigate";
import { readTool } from "../../src/webview/annotation-mode";
import { pagedDragHandler } from "../../src/webview/paged-drag-navigate";

const page = { kind: "objectNumber" as const, objectNumber: 1 };

/**
 * How `@embedpdf/web` `createStageSurface` builds a sample: viewport is CSS
 * px of the Stage container (`clientX - rect.left`). `page.scale` is CSS px
 * per PDF page unit; `page.point` is that viewport divided by scale.
 */
function nativeSample(
  client: { x: number; y: number },
  options: {
    rect?: { left: number; top: number };
    onPage?: boolean;
    scale?: number;
    zoom?: number;
    phase?: PointerSample["phase"];
  } = {},
): PointerSample {
  const rect = options.rect ?? { left: 0, top: 0 };
  const scale = options.scale ?? 1;
  const viewport = { x: client.x - rect.left, y: client.y - rect.top };
  return {
    phase: options.phase ?? "down",
    viewport,
    ...(options.onPage === false
      ? {}
      : {
          page: {
            ref: page,
            point: { x: viewport.x / scale, y: viewport.y / scale },
            scale,
            zoom: options.zoom ?? scale,
          },
        }),
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

/** A sample whose page-space point is not viewport/scale (a unit leak). */
function sampleWithSpaces(
  viewport: { x: number; y: number },
  pagePoint: { x: number; y: number },
  scale: number,
  phase: PointerSample["phase"] = "down",
): PointerSample {
  return {
    phase,
    viewport,
    page: { ref: page, point: pagePoint, scale, zoom: scale },
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

function pagedHandler(direction: "vertical" | "horizontal" = "vertical") {
  const steps: Array<1 | -1> = [];
  const handler = pagedDragHandler({
    isPaged: () => true,
    direction: () => direction,
    step: (delta) => steps.push(delta),
    selection: () => null,
  });
  return { handler, steps };
}

test("an upward blank drag in page-by-page mode turns to the next page", () => {
  // Matches the failed Host GUI swipe: (900, 620) -> (900, 180) stayed on page 1.
  const { handler, steps } = pagedHandler();
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
  const start = nativeSample({ x: 900, y: 620 }, { scale: 4, zoom: 4 });
  const end = nativeSample(
    { x: 900, y: 180 },
    { scale: 4, zoom: 4, phase: "up" },
  );
  assert.equal(handler.onPointerDown(start), true);
  handler.onPointerMove?.(
    nativeSample({ x: 900, y: 180 }, { scale: 4, zoom: 4, phase: "move" }),
  );
  handler.onPointerUp?.(end);
  assert.deepEqual(steps, [1]);
});

test("an edge-to-edge upward drag also turns, even when it could have panned first", () => {
  const { handler, steps } = pagedHandler();
  handler.onPointerDown(nativeSample({ x: 900, y: 730 }, { scale: 4 }));
  handler.onPointerUp?.(
    nativeSample({ x: 900, y: 80 }, { scale: 4, phase: "up" }),
  );
  assert.deepEqual(steps, [1]);
});

test("a downward drag turns to the previous page", () => {
  const { handler, steps } = pagedHandler();
  handler.onPointerDown(nativeSample({ x: 900, y: 180 }, { scale: 4 }));
  handler.onPointerUp?.(
    nativeSample({ x: 900, y: 620 }, { scale: 4, phase: "up" }),
  );
  assert.deepEqual(steps, [-1]);
});

test("continuous scrolling does not capture a blank drag (Stage pan keeps it)", () => {
  const handler = pagedDragHandler({
    isPaged: () => false,
    direction: () => "vertical",
    step: () => {
      throw new Error("must not step");
    },
    selection: () => null,
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
    selection: () => null,
  });
  assert.equal(
    handler.onPointerDown(nativeSample({ x: 900, y: 620 }, { onPage: false })),
    false,
  );
});

test("a cancelled gesture does not turn, even if the pointer later moves far", () => {
  const { handler, steps } = pagedHandler();
  assert.equal(
    handler.onPointerDown(nativeSample({ x: 900, y: 520 }, { scale: 2.53 })),
    true,
  );
  handler.onPointerCancel?.(
    nativeSample({ x: 900, y: 100 }, { scale: 2.53, phase: "cancel" }),
  );
  handler.onPointerUp?.(
    nativeSample({ x: 900, y: 100 }, { scale: 2.53, phase: "up" }),
  );
  assert.deepEqual(steps, []);
});

test("travel is Stage viewport CSS px, not PDF page units", () => {
  // page.point moved 80 units (above 60) while viewport moved 50 CSS px.
  const missed = pagedHandler();
  missed.handler.onPointerDown(
    sampleWithSpaces({ x: 900, y: 520 }, { x: 225, y: 130 }, 4),
  );
  missed.handler.onPointerUp?.(
    sampleWithSpaces({ x: 900, y: 470 }, { x: 225, y: 50 }, 4, "up"),
  );
  assert.deepEqual(
    missed.steps,
    [],
    "50 CSS px must not turn just because page.point moved 80",
  );

  // viewport moved 60 CSS px while page.point moved only 15 (below 60).
  const reached = pagedHandler();
  reached.handler.onPointerDown(
    sampleWithSpaces({ x: 900, y: 520 }, { x: 225, y: 130 }, 4),
  );
  reached.handler.onPointerUp?.(
    sampleWithSpaces({ x: 900, y: 460 }, { x: 225, y: 115 }, 4, "up"),
  );
  assert.deepEqual(
    reached.steps,
    [1],
    "60 CSS px must turn even when page.point moved only 15",
  );
});

test("the 60 CSS px threshold does not change with PDF zoom", () => {
  for (const scale of [1, 2.53, 4]) {
    const short = pagedHandler();
    short.handler.onPointerDown(
      nativeSample({ x: 900, y: 520 }, { scale, zoom: scale }),
    );
    short.handler.onPointerUp?.(
      nativeSample({ x: 900, y: 470 }, { scale, zoom: scale, phase: "up" }),
    );
    assert.deepEqual(
      short.steps,
      [],
      `50 CSS px must not turn at scale ${scale}`,
    );

    const edge = pagedHandler();
    edge.handler.onPointerDown(
      nativeSample({ x: 900, y: 520 }, { scale, zoom: scale }),
    );
    edge.handler.onPointerUp?.(
      nativeSample({ x: 900, y: 461 }, { scale, zoom: scale, phase: "up" }),
    );
    assert.deepEqual(
      edge.steps,
      [],
      `59 CSS px must not turn at scale ${scale}`,
    );

    const turn = pagedHandler();
    turn.handler.onPointerDown(
      nativeSample({ x: 900, y: 520 }, { scale, zoom: scale }),
    );
    turn.handler.onPointerUp?.(
      nativeSample({ x: 900, y: 460 }, { scale, zoom: scale, phase: "up" }),
    );
    assert.deepEqual(turn.steps, [1], `60 CSS px must turn at scale ${scale}`);
  }
});

test("a 50 px screenshot drag on a 1.5× capture is 75 CSS px and does turn", () => {
  // Host GUI (900,520)->(900,470) was 50 px on 1280x800 screenshots of a
  // 1920x1200 display. Stage viewport is CSS = X11 px, not screenshot px.
  const screenshotPx = 50;
  const cssPx = screenshotPx * (1920 / 1280);
  assert.equal(cssPx, 75);
  const { handler, steps } = pagedHandler();
  handler.onPointerDown(nativeSample({ x: 900, y: 520 }, { scale: 4 }));
  handler.onPointerUp?.(
    nativeSample({ x: 900, y: 520 - cssPx }, { scale: 4, phase: "up" }),
  );
  assert.deepEqual(steps, [1]);
  assert.equal(
    pagedDragPageDelta({ x: 900, y: 520 }, { x: 900, y: 470 }, "vertical"),
    0,
  );
});

test("a horizontal drag turns along the reading direction at Fit Page scale", () => {
  const { handler, steps } = pagedHandler("horizontal");
  handler.onPointerDown(nativeSample({ x: 700, y: 400 }, { scale: 2.53 }));
  handler.onPointerUp?.(
    nativeSample({ x: 640, y: 400 }, { scale: 2.53, phase: "up" }),
  );
  assert.deepEqual(steps, [1]);
  const back = pagedHandler("horizontal");
  back.handler.onPointerDown(nativeSample({ x: 200, y: 400 }, { scale: 2.53 }));
  back.handler.onPointerUp?.(
    nativeSample({ x: 260, y: 400 }, { scale: 2.53, phase: "up" }),
  );
  assert.deepEqual(back.steps, [-1]);
  const short = pagedHandler("horizontal");
  short.handler.onPointerDown(
    nativeSample({ x: 700, y: 400 }, { scale: 2.53 }),
  );
  short.handler.onPointerUp?.(
    nativeSample({ x: 650, y: 400 }, { scale: 2.53, phase: "up" }),
  );
  assert.deepEqual(short.steps, []);
});

test("the read tool still enables pan so continuous blank-area drag can scroll", () => {
  assert.ok(readTool().enables.has("scroll"));
  assert.equal(readTool().id, READ_TOOL_ID);
});

/**
 * The real EmbedPDF interaction controller (`interactionPlugin().create`),
 * not a reimplementation of `wouldClaimTouch`.
 */
function bootHub(): InteractionHostCapability {
  let model: {
    activeToolId: string;
    toolStack: string[];
    cursor: string;
  } = { activeToolId: "pointer", toolStack: [], cursor: "default" };
  const listeners = new Set<
    (change: { previous: typeof model; next: typeof model }) => void
  >();
  const created = interactionPlugin().create({
    settings: () => ({
      get: () => ({ ...INTERACTION_DEFAULTS }),
      api: {
        getSettings: () => ({ ...INTERACTION_DEFAULTS }),
        updateSettings() {},
        resetSettings() {},
        onSettingsChanged: () => () => {},
      },
    }),
    events: { source: () => createEventHook() },
    state: {
      get: () => model,
      update: (
        fn: (state: typeof model, ...args: unknown[]) => typeof model,
        ...args: unknown[]
      ) => {
        const previous = model;
        const next = fn(model, ...args);
        if (next !== previous) {
          model = next;
          for (const listener of listeners) {
            listener({ previous, next });
          }
        }
      },
      onChange: (
        listener: (change: {
          previous: typeof model;
          next: typeof model;
        }) => void,
      ) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notify: () => {},
  } as never);
  return created.api;
}

function touchSample(
  options: {
    onPage?: boolean;
    pointerType?: PointerSample["pointerType"];
  } = {},
): PointerSample {
  return {
    ...nativeSample(
      { x: 200, y: 300 },
      {
        ...(options.onPage === undefined ? {} : { onPage: options.onPage }),
        scale: 2.53,
      },
    ),
    pointerType: options.pointerType ?? "touch",
  };
}

function selectionStub(state: { loaded: boolean; overText: boolean }) {
  return {
    isLoaded: () => state.loaded,
    isOverText: () => state.overText,
  };
}

function hubWithPagedDrag(options: {
  isPaged?: boolean;
  loaded?: boolean;
  overText?: boolean;
  missingSelection?: boolean;
}): InteractionHostCapability {
  const hub = bootHub();
  hub.registerTool(readTool());
  hub.activateTool(READ_TOOL_ID);
  hub.registerHandler(
    pagedDragHandler({
      isPaged: () => options.isPaged ?? true,
      direction: () => "vertical",
      step: () => {
        throw new Error("must not step during wouldClaimTouch");
      },
      selection: () =>
        options.missingSelection
          ? null
          : selectionStub({
              loaded: options.loaded ?? true,
              overText: options.overText ?? false,
            }),
    }),
  );
  return hub;
}

test("the real hub wouldClaimTouch a loaded blank touch in page-by-page mode", () => {
  const hub = hubWithPagedDrag({ loaded: true, overText: false });
  assert.equal(hub.wouldClaimTouch(touchSample()), true);
});

test("the real hub does not wouldClaimTouch text, unloaded geometry, off-page, missing selection, or continuous mode", () => {
  assert.equal(
    hubWithPagedDrag({ overText: true }).wouldClaimTouch(touchSample()),
    false,
  );
  assert.equal(
    hubWithPagedDrag({ loaded: false }).wouldClaimTouch(touchSample()),
    false,
  );
  assert.equal(
    hubWithPagedDrag({}).wouldClaimTouch(touchSample({ onPage: false })),
    false,
  );
  assert.equal(
    hubWithPagedDrag({ missingSelection: true }).wouldClaimTouch(touchSample()),
    false,
  );
  assert.equal(
    hubWithPagedDrag({ isPaged: false }).wouldClaimTouch(touchSample()),
    false,
    "enabledFor is false in continuous, so the hub never asks claimsTouch",
  );
});

test("a cancelled paged blank drag is the handler side of a two-finger pinch", () => {
  // Source: @embedpdf/web createStageGestureController, mode "tool" + a
  // second finger calls sink.cancel then enterPinch. Device pinch is not
  // exercised here.
  const { handler, steps } = pagedHandler();
  assert.equal(
    handler.onPointerDown(
      nativeSample({ x: 900, y: 520 }, { scale: 2.53, phase: "down" }),
    ),
    true,
  );
  handler.onPointerCancel?.(
    nativeSample({ x: 900, y: 520 }, { scale: 2.53, phase: "cancel" }),
  );
  assert.deepEqual(steps, []);
});
