import assert from "node:assert/strict";
import { test } from "node:test";
import { positionFromView } from "../../src/shared/reading-position";
import type { ViewerAction } from "../../src/shared/view-state";
import { nextZoomStep } from "../../src/shared/zoom-steps";
import { Throttle } from "../../src/shared/throttle";
import { readingPlace } from "../../src/webview/stage-position";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

/** A value as the test's realm has it: what the viewer builds lives in another one. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A Stage laid out at `level`, with the corner at (12, 340) on the page with
 * object number 42; the Stage's own destination is the point padding further in.
 */
function fakeStage(
  options: { level?: number; mode?: string; page?: number } = {},
) {
  let level = options.level ?? 1.25;
  let mode = options.mode ?? "custom";
  const calls: unknown[][] = [];
  const stage = {
    getZoomLevel: () => level,
    getZoomMode: () => mode,
    getCurrentDestination: () => ({
      kind: "xyz",
      page: { kind: "objectNumber", objectNumber: 42 },
      x: 24,
      y: 352,
      zoom: null,
    }),
    viewportToPage: () => ({ x: 12, y: 340 }),
    listVisiblePages: () => [
      {
        pageIndex: (options.page ?? 4) - 1,
        ref: { kind: "objectNumber", objectNumber: 42 },
      },
    ],
    zoomTo: (value: number) => {
      calls.push(["zoomTo", value]);
      level = value;
      mode = "custom";
    },
    fitWidth: () => {
      calls.push(["fitWidth"]);
      mode = "fit-width";
    },
    fitPage: () => {
      calls.push(["fitPage"]);
      mode = "fit-page";
    },
  };
  return { stage, calls };
}

const navigation = {
  currentPage: 4,
  pageCount: 12,
  canGoBack: true,
  canGoForward: false,
};
const choices = {
  pageLayout: "single",
  scrollMode: "continuous",
  scrollDirection: "vertical",
} as const;

interface Report {
  view: Record<string, unknown>;
}

function load(stage: unknown) {
  const hooks = fakeReact();
  const reports: Report[] = [];
  const remembered: unknown[] = [];
  let cameraMoved: () => void = () => undefined;
  // Time the test moves: the viewer reports a pan at most every PAN_REPORT_MS.
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 0;
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
    }
    now = until;
  };
  const module = loadHook(
    "view-sync.ts",
    {
      react: hooks.react,
      "@embedpdf/react/stage": {
        useStageEvent: (_select: unknown, handler: () => void) => {
          cameraMoved = handler;
        },
      },
      "../shared/reading-position": { positionFromView },
      "../shared/throttle": { Throttle },
      "../shared/zoom-steps": { nextZoomStep },
      "./reading-position": {
        rememberPosition: (position: unknown) => remembered.push(position),
      },
      "./host": { reportToHost: (report: Report) => reports.push(report) },
      "./stage-capability": { useStageApi: () => stage },
      "./stage-position": { readingPlace },
    },
    {
      performance: { now: () => now },
      setTimeout: (run: () => void, ms: number) => {
        timers.set(++nextTimer, { at: now + ms, run });
        return nextTimer;
      },
      clearTimeout: (handle: number) => timers.delete(handle),
    },
  ) as {
    currentView(input: unknown): Record<string, unknown> | undefined;
    fitMode(mode: string): string | null;
    useViewReporting(...args: unknown[]): void;
    useViewActions(...args: unknown[]): (action: ViewerAction) => void;
    PAN_REPORT_MS: number;
  };
  return {
    ...module,
    advance,
    hooks,
    reports,
    remembered,
    cameraMoved: () => cameraMoved(),
  };
}

test("a view report says where the reader is: the page, the zoom and the place at the corner", () => {
  const { stage } = fakeStage();
  const { currentView } = load(stage);
  const view = currentView({ navigation, tool: "text", choices, stage });
  assert.equal(view?.page, 4);
  assert.equal(view?.readingPage, 4);
  assert.equal(view?.pageCount, 12);
  assert.equal(view?.zoomPercent, 125);
  assert.equal(view?.zoom, 125);
  assert.equal(view?.fit, null);
  assert.equal(view?.top, 340);
  assert.equal(view?.left, 12);
  assert.equal(view?.canGoBack, true);
  assert.equal(view?.canGoForward, false);
});

test("a report in a fit mode names the mode as the zoom, and none is made before a page is laid out", () => {
  const fit = fakeStage({ mode: "fit-page", level: 0.6 });
  const { currentView } = load(fit.stage);
  const view = currentView({
    navigation,
    tool: "text",
    choices,
    stage: fit.stage,
  });
  assert.equal(view?.fit, "page");
  assert.equal(view?.zoom, "fitPage");
  assert.equal(view?.zoomPercent, 60);
  const empty = { ...fit.stage, listVisiblePages: () => [] };
  assert.equal(
    currentView({ navigation, tool: "text", choices, stage: empty }),
    undefined,
  );
  assert.equal(
    currentView({
      navigation: { ...navigation, pageCount: 0 },
      tool: "text",
      choices,
      stage: fit.stage,
    }),
    undefined,
  );
});

test("annotation state is reported only in the annotate tool", () => {
  const { stage } = fakeStage();
  const { currentView } = load(stage);
  const annotation = { annotationTool: "ink", canUndo: true, canRedo: false };
  const input = { navigation, choices, stage, annotation };
  assert.equal(
    currentView({ ...input, tool: "text" })?.annotationTool,
    undefined,
  );
  const view = currentView({ ...input, tool: "annotate" });
  assert.equal(view?.annotationTool, "ink");
  assert.equal(view?.canAnnotationUndo, true);
  assert.equal(view?.canAnnotationRedo, false);
});

test("fit modes of the Stage are the viewer's fit modes; a level is none", () => {
  const { fitMode } = load(fakeStage().stage);
  assert.equal(fitMode("fit-width"), "width");
  assert.equal(fitMode("fit-page"), "page");
  for (const mode of ["custom", "automatic", "fit-all"]) {
    assert.equal(fitMode(mode), null);
  }
});

test("each distinct view is reported once, on a render and on a camera move", () => {
  const { stage } = fakeStage();
  const view = load(stage);
  const render = (): void =>
    view.hooks.render(() => view.useViewReporting(navigation, "text", choices));
  render();
  render();
  view.cameraMoved();
  assert.equal(view.reports.length, 1);
  assert.equal(view.remembered.length, 1);
  assert.equal(view.reports[0]!.view.top, 340);
  // A pan moves the place without a render: the camera event reports it.
  stage.viewportToPage = () => ({ x: 12, y: 500 });
  view.cameraMoved();
  view.advance(view.PAN_REPORT_MS);
  assert.equal(view.reports.length, 2);
  assert.equal(view.reports[1]!.view.top, 500);
});

test("a pan reports at once, then once every PAN_REPORT_MS, and ends where the reader stopped", () => {
  const { stage } = fakeStage();
  const view = load(stage);
  view.hooks.render(() => view.useViewReporting(navigation, "text", choices));
  assert.equal(view.reports.length, 1);
  // A trackpad flick: a camera event every 8 ms (120 Hz) for 320 ms.
  let top = 340;
  for (let event = 0; event < 40; event++) {
    top += 10;
    stage.viewportToPage = () => ({ x: 12, y: top });
    view.cameraMoved();
    view.advance(8);
  }
  view.advance(view.PAN_REPORT_MS);
  const sent = view.reports.length - 1;
  assert.ok(
    sent >= 3 && sent <= 5,
    `40 camera events were reported ${sent} times`,
  );
  assert.equal(view.reports.at(-1)!.view.top, top);
  assert.equal(view.remembered.length, view.reports.length);
});

/** The hook with the pieces a zoom action needs; `show` and `step` record what they are asked. */
function actions(stage: unknown) {
  const view = load(stage);
  const calls: unknown[][] = [];
  const intent = {
    interrupt: () => calls.push(["interrupt"]),
    advance: () => calls.push(["advance"]),
  };
  const nav = {
    ...navigation,
    intent,
    show: (...args: unknown[]) => calls.push(["show", ...args]),
    goToPage: (page: number) => calls.push(["goToPage", page]),
    step: (...args: unknown[]) => calls.push(["step", ...args]),
  };
  const noop = (): void => undefined;
  const run = view.hooks.render(() =>
    view.useViewActions(nav, () => calls.push(["find"]), noop, {
      setChoices: (value: unknown) => calls.push(["setChoices", value]),
      setAnnotationTool: noop,
      setColor: noop,
      undo: noop,
      redo: noop,
      deleteSelectedAnnotations: noop,
    }),
  );
  return { run, calls };
}

test("zoom buttons step Lumiere's own ladder from the level shown, so quick repeats add up", () => {
  const { stage, calls: zoom } = fakeStage({ level: 1 });
  const { run } = actions(stage);
  run({ action: "zoomIn" });
  run({ action: "zoomIn" });
  run({ action: "zoomOut" });
  assert.deepEqual(zoom, [
    ["zoomTo", 1.1],
    ["zoomTo", 1.25],
    ["zoomTo", 1.1],
  ]);
  run({ action: "setZoom", percent: 62.5 });
  run({ action: "actualSize" });
  run({ action: "fitWidth" });
  assert.deepEqual(zoom.slice(3), [
    ["zoomTo", 0.625],
    ["zoomTo", 1],
    ["fitWidth"],
  ]);
});

test("fit page keeps the reader on the page they were on", () => {
  const { stage, calls: zoom } = fakeStage();
  const { run, calls } = actions(stage);
  run({ action: "fitPage" });
  assert.deepEqual(zoom, [["fitPage"]]);
  assert.deepEqual(plain(calls.filter(([name]) => name === "show")), [
    ["show", { page: 4 }, null, 0, true],
  ]);
});

test("layout, page and keep-place actions go to the viewer's own state and navigation", () => {
  const { stage } = fakeStage();
  const { run, calls } = actions(stage);
  run({ action: "setScrollMode", scrollMode: "paged" });
  run({ action: "setPageLayout", pageLayout: "spread" });
  run({ action: "setScrollDirection", scrollDirection: "horizontal" });
  run({ action: "nextPageKeepingPlace" });
  run({ action: "previousPage" });
  run({ action: "goToPage", page: 7 });
  run({ action: "find" });
  const named = calls.filter(
    ([name]) => name !== "interrupt" && name !== "advance",
  );
  assert.deepEqual(plain(named), [
    ["setChoices", { scrollMode: "paged" }],
    ["setChoices", { pageLayout: "spread" }],
    ["setChoices", { scrollDirection: "horizontal" }],
    ["step", 1, true],
    ["step", -1],
    ["goToPage", 7],
    ["find"],
  ]);
  assert.equal(
    calls.filter(([name]) => name === "advance").length,
    1,
    "only Find advances",
  );
});
