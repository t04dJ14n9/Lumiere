import assert from "node:assert/strict";
import { test } from "node:test";
import { fromViewRect } from "../../src/shared/geometry";
import { NavigationIntent } from "../../src/shared/navigation-intent";
import { keyMove, swappedArrow } from "../../src/shared/paging-keys";
import type { ReadingPosition } from "../../src/shared/reading-position";
import {
  WheelGesture,
  wheelPixels,
  wheelTarget,
} from "../../src/shared/smooth-motion";
import { resolveSmoothScrolling } from "../../src/shared/view-settings";
import { layoutApplied, layoutSettings } from "../../src/webview/stage-layout";
import { readingPlace, zoomChoice } from "../../src/webview/stage-position";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";
import { realStage } from "./support/real-stage";

/**
 * The viewer's navigation, layout, keys and wheel against EmbedPDF's real
 * Stage (see support/real-stage.ts), to see that what they ask of it lands
 * where they mean: the Stage's own coordinates and alignment rules are the
 * thing the fakes in the other tests cannot vouch for.
 */

type Stage = ReturnType<typeof realStage>;

const choices = {
  pageLayout: "single",
  scrollMode: "continuous",
  scrollDirection: "vertical",
} as const;

interface Navigation {
  show(location: unknown, top?: number): void;
  restore(position: ReadingPosition): void;
  step(delta: 1 | -1, keepPlace?: boolean): void;
  goToPage(page: number, top?: number): void;
}

function navigationOn(stage: Stage, mode = "continuous"): Navigation {
  const hooks = fakeReact();
  const module = loadHook(
    "navigation.ts",
    {
      react: hooks.react,
      "@embedpdf/react/stage": {
        useStageState: () => ({ pageCount: stage.getPageCount() }),
      },
      "../shared/geometry": { fromViewRect },
      "../shared/navigation-intent": { NavigationIntent },
      "./reading-position": {
        nativeZoom: (choice: ReadingPosition["zoom"]) =>
          choice === "fitWidth"
            ? { mode: "fit-width" }
            : { level: Number(choice) / 100 },
      },
      "./stage-capability": { useStageApi: () => stage },
    },
    {
      Element: class {},
      KeyboardEvent: class {},
      document: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    },
  );
  const use = module.useNavigation as (
    mode: string,
    smooth: boolean,
  ) => Navigation;
  return hooks.render(() => use(mode, false));
}

/** The reader's place within a point or so: the Stage lays out on whole device pixels. */
function assertPlace(
  stage: Stage,
  expected: { page: number; top: number; left: number },
): void {
  const place = readingPlace(stage);
  assert.equal(place?.page, expected.page);
  assert.ok(Math.abs(place!.top - expected.top) < 1, `top ${place?.top}`);
  assert.ok(Math.abs(place!.left - expected.left) < 1, `left ${place?.left}`);
}

test("a saved position is put back by one restore: page, point and number zoom", () => {
  const stage = realStage();
  navigationOn(stage).restore({
    ...choices,
    page: 3,
    top: 120,
    left: 0,
    zoom: 150,
  });
  assert.equal(stage.getZoomLevel(), 1.5);
  assert.equal(zoomChoice(stage), 150);
  assertPlace(stage, { page: 3, top: 120, left: 0 });
});

test("a zoomed-in position keeps its left offset, and a fit mode is the Stage's own", () => {
  const stage = realStage({ count: 6, width: 500 });
  navigationOn(stage).restore({
    ...choices,
    page: 2,
    top: 60,
    left: 60,
    zoom: 100,
  });
  assertPlace(stage, { page: 2, top: 60, left: 60 });
  navigationOn(stage).restore({
    ...choices,
    page: 4,
    top: 30,
    left: 0,
    zoom: "fitWidth" as unknown as number,
  });
  assert.equal(stage.getZoomMode(), "fit-width");
  assertPlace(stage, { page: 4, top: 30, left: 0 });
});

test("a position restored before the Stage has a size is in the very first layout, continuous or paged", () => {
  for (const flow of ["continuous", "paged"] as const) {
    for (const zoom of [150, "fitWidth" as unknown as number]) {
      const stage = realStage({ unsized: true, config: { flow } });
      navigationOn(stage, flow).restore({
        ...choices,
        scrollMode: flow,
        page: 4,
        top: 90,
        left: 0,
        zoom,
      });
      stage.setViewportSize({ width: 900, height: 700 });
      assertPlace(stage, { page: 4, top: 90, left: 0 });
      assert.equal(stage.getZoomMode(), zoom === 150 ? "custom" : "fit-width");
    }
  }
});

test("a page jump lands the page at the top; a link's point lands at the corner", () => {
  const stage = realStage();
  const navigation = navigationOn(stage);
  navigation.goToPage(5);
  assertPlace(stage, { page: 5, top: 0, left: 0 });
  navigation.goToPage(2, 200);
  assertPlace(stage, { page: 2, top: 200, left: 0 });
});

test("a box lands with its top-left a fifth of the way down the viewer", () => {
  const stage = realStage();
  navigationOn(stage).show({
    page: 4,
    viewRect: { left: 72, top: 83, width: 134, height: 21 },
  });
  const at = stage.pageToViewport(3, { x: 72, y: 83 });
  assert.ok(Math.abs(at!.y - 0.2 * 700) < 1, `y ${at?.y}`);
});

test("turning the page keeping the place keeps the zoom and the point of the page at the corner", () => {
  const stage = realStage();
  const navigation = navigationOn(stage);
  navigation.goToPage(2, 150);
  const zoom = stage.getZoomLevel();
  navigation.step(1, true);
  assert.equal(stage.getZoomLevel(), zoom);
  assertPlace(stage, { page: 3, top: 150, left: 0 });
  navigation.step(-1, true);
  assertPlace(stage, { page: 2, top: 150, left: 0 });
  navigation.step(1);
  assertPlace(stage, { page: 3, top: 0, left: 0 });
});

test("one page at a time: a step lands the next page, and the end is the end", () => {
  const stage = realStage({ count: 3, config: { flow: "paged" } });
  const navigation = navigationOn(stage, "paged");
  navigation.step(1);
  navigation.step(1);
  navigation.step(1);
  assert.equal(stage.getCurrentPageIndex(), 2);
  assert.equal(stage.canGoNext(), false);
  assertPlace(stage, { page: 3, top: 0, left: 0 });
});

test("a new layout keeps the reader on their page, at its top", () => {
  const stage = realStage({ count: 7, width: 1400 });
  const hooks = fakeReact();
  const module = loadHook("view-layout.ts", {
    react: hooks.react,
    "./stage-capability": { useStageApi: () => stage },
    "./stage-layout": { layoutApplied, layoutSettings },
  });
  const use = module.useViewLayout as (
    choices: unknown,
    smooth: boolean,
  ) => void;
  const render = (patch: object): void =>
    hooks.render(() => use({ ...choices, ...patch }, false));
  navigationOn(stage).goToPage(4, 300);
  render({});
  assertPlace(stage, { page: 4, top: 300, left: 0 });
  render({ pageLayout: "spread" });
  assert.equal(stage.getSettings().spread, "odd");
  assert.deepEqual(
    stage.listCurrentPages().map((page) => page.index),
    [2, 3],
  );
  assertPlace(stage, { page: 3, top: 0, left: 0 });
  render({ pageLayout: "spread", scrollMode: "paged" });
  assert.equal(stage.getSettings().flow, "paged");
  assert.equal(stage.getCurrentPageIndex() >= 2, true);
  render({
    pageLayout: "spread",
    scrollMode: "paged",
    scrollDirection: "horizontal",
  });
  assert.equal(stage.getSettings().layout, "horizontal");
  render({
    pageLayout: "spread",
    scrollMode: "paged",
    scrollDirection: "horizontal",
  });
});

test("a smooth-motion change reaches the Stage's scroll behavior, in continuous scrolling only", () => {
  const stage = realStage();
  const hooks = fakeReact();
  const module = loadHook("view-layout.ts", {
    react: hooks.react,
    "./stage-capability": { useStageApi: () => stage },
    "./stage-layout": { layoutApplied, layoutSettings },
  });
  const use = module.useViewLayout as (
    choices: unknown,
    smooth: boolean,
  ) => void;
  hooks.render(() => use(choices, true));
  assert.equal(stage.getSettings().scrollBehavior, "smooth");
  hooks.render(() => use({ ...choices, scrollMode: "paged" }, true));
  assert.equal(stage.getSettings().scrollBehavior, "instant");
  hooks.render(() => use({ ...choices, scrollMode: "paged" }, false));
  assert.equal(stage.getSettings().scrollBehavior, "instant");
});

/** Press a key the way the document does, against the real Stage; returns the page turns asked for. */
function press(stage: Stage, key: string, mode = "continuous") {
  const hooks = fakeReact();
  const turns: number[] = [];
  let listener: (event: unknown) => void = () => undefined;
  const module = loadHook(
    "paging-input.ts",
    {
      react: hooks.react,
      "../shared/paging-keys": { keyMove, swappedArrow },
      "./reading-position": {
        currentViewSettings: () => ({ arrowsKeepPlace: false }),
      },
      "./stage-capability": { useStageApi: () => stage },
    },
    {
      Element: class {},
      navigator: { userAgent: "Linux" },
      document: {
        addEventListener: (
          _name: string,
          handler: (event: unknown) => void,
        ) => {
          listener = handler;
        },
        removeEventListener: () => undefined,
      },
    },
  );
  hooks.render(() =>
    (module.usePagingKeys as (input: unknown) => void)({
      mode,
      direction: "vertical",
      step: (delta: number) => turns.push(delta),
    }),
  );
  listener({ key, target: {}, preventDefault: () => undefined });
  return turns;
}

test("arrow keys pan the real Stage by 40 pixels, and a Page key most of a screen", () => {
  const stage = realStage();
  const top = (): number => stage.getScrollMetrics().scrollTop;
  const start = top();
  press(stage, "ArrowDown");
  assert.equal(top() - start, 40);
  press(stage, "ArrowUp");
  assert.equal(top(), start);
  press(stage, "PageDown");
  assert.equal(top() - start, 612.5);
});

test("a paged page is read to its end by keys, then the page turns", () => {
  const stage = realStage({ count: 3, config: { flow: "paged" } });
  const turns: number[] = [];
  for (let key = 0; key < 40 && turns.length === 0; key++) {
    turns.push(...press(stage, "ArrowDown", "paged"));
  }
  const metrics = stage.getScrollMetrics();
  assert.deepEqual(turns, [1]);
  assert.ok(
    metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 1,
    "at the bottom of the page when it turned",
  );
});

/** A mouse wheel notch over the viewer, delivered to the viewer's wheel listener. */
function notch(stage: Stage, options: { shift: boolean; direction: string }) {
  class Element {
    closest(): this {
      return this;
    }
  }
  const hooks = fakeReact();
  const listeners = new Map<string, (event: unknown) => void>();
  const module = loadHook(
    "smooth-scrolling.ts",
    {
      react: hooks.react,
      "../shared/smooth-motion": { WheelGesture, wheelPixels, wheelTarget },
      "../shared/view-settings": { resolveSmoothScrolling },
      "./stage-capability": { useStageApi: () => stage },
      "./note-card-target": { scrollsNoteCard: () => false },
    },
    { Element },
  );
  const container = {
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      listeners.set(name, handler),
    removeEventListener: () => undefined,
  };
  hooks.render(() =>
    (module.useSmoothWheel as (...args: unknown[]) => void)(
      { current: container },
      true,
      options.direction,
      "continuous",
    ),
  );
  listeners.get("wheel")!({
    target: new Element(),
    deltaY: 100,
    deltaX: 0,
    deltaMode: 0,
    shiftKey: options.shift,
    ctrlKey: false,
    metaKey: false,
    timeStamp: 0,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });
}

test("a wheel notch scrolls the real Stage by a notch, sideways with Shift", () => {
  const stage = realStage({ width: 300, config: { zoom: { level: 1 } } });
  assert.equal(stage.getScrollMetrics().scrollableX, true);
  const before = stage.getScrollMetrics();
  notch(stage, { shift: false, direction: "vertical" });
  const down = stage.getScrollMetrics();
  assert.equal(down.scrollTop - before.scrollTop, 100);
  assert.equal(down.scrollLeft, before.scrollLeft);
  notch(stage, { shift: true, direction: "vertical" });
  assert.equal(stage.getScrollMetrics().scrollLeft - before.scrollLeft, 100);
  notch(stage, { shift: false, direction: "horizontal" });
  assert.equal(stage.getScrollMetrics().scrollLeft - before.scrollLeft, 200);
});
