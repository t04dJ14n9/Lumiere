import assert from "node:assert/strict";
import { test } from "node:test";
import { fromViewRect } from "../../src/shared/geometry";
import { NavigationIntent } from "../../src/shared/navigation-intent";
import type { ReadingPosition } from "../../src/shared/reading-position";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

type Call = unknown[];

interface StageOptions {
  pages?: number;
  /** The display indexes of the pages the reader is on. */
  currentPages?: number[];
  /** The page the reader went to (the first of `currentPages` by default). */
  cursor?: number;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
  laidOut?: boolean;
  zoomMode?: string;
  destination?: unknown;
}

/** The Stage, recording each call it is asked to make (copied out of the module's realm). */
function fakeStage(options: StageOptions = {}) {
  const calls: Call[] = [];
  let cursor = options.cursor ?? options.currentPages?.[0] ?? 0;
  const record =
    (name: string, effect?: () => void) =>
    (...args: unknown[]): void => {
      calls.push(JSON.parse(JSON.stringify([name, ...args])) as Call);
      effect?.();
    };
  const stage = {
    getPageCount: () => options.pages ?? 10,
    listVisiblePages: () => (options.laidOut === false ? [] : [{}]),
    listCurrentPages: () =>
      (options.currentPages ?? [cursor]).map((index) => ({ index })),
    getCurrentPageIndex: () => cursor,
    canGoNext: () => options.canGoNext ?? true,
    canGoPrevious: () => options.canGoPrevious ?? true,
    getCurrentDestination: () => options.destination ?? null,
    getZoomMode: () => options.zoomMode ?? "fit-width",
    goToPage: record("goToPage"),
    reveal: record("reveal"),
    zoomTo: record("zoomTo"),
    nextPage: record("nextPage", () => {
      cursor += 1;
    }),
    previousPage: record("previousPage", () => {
      cursor -= 1;
    }),
  };
  return { stage, calls };
}

interface Nav {
  intent: NavigationIntent;
  isReady(): boolean;
  currentPage: number;
  pageCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  highlight?: { page: number; rect: number[]; key: number };
  show(
    location: { page: number; viewRect?: unknown },
    top?: number,
    left?: number,
    instant?: boolean,
  ): void;
  restore(position: ReadingPosition): void;
  reveal(page: number, rect: number[], deliberate?: boolean): void;
  goToPage(page: number, top?: number): void;
  step(delta: 1 | -1, keepPlace?: boolean): void;
}

class Element {
  private readonly region: "viewport" | "input" | "button";
  constructor(region: "viewport" | "input" | "button") {
    this.region = region;
  }
  closest(selector: string): Element | null {
    return (
      selector === ".viewport"
        ? this.region === "viewport"
        : this.region === "input"
    )
      ? this
      : null;
  }
}

class KeyboardEvent {
  readonly altKey = false;
  readonly ctrlKey = false;
  readonly metaKey = false;
  readonly shiftKey = false;
  readonly key: string;
  readonly target: Element;
  constructor(key: string, target: Element) {
    this.key = key;
    this.target = target;
  }
}

function harness(stage: ReturnType<typeof fakeStage>["stage"]) {
  const hooks = fakeReact();
  const listeners = new Map<string, (event: unknown) => void>();
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
        nativeZoom: (choice: ReadingPosition["zoom"]) => {
          if (choice === "fitWidth") {
            return { mode: "fit-width" };
          }
          if (choice === "fitPage") {
            return { mode: "fit-page" };
          }
          return { level: choice === "actual" ? 1 : choice / 100 };
        },
      },
      "./stage-capability": { useStageApi: () => stage },
    },
    {
      Element,
      KeyboardEvent,
      document: {
        addEventListener: (name: string, listener: (event: unknown) => void) =>
          listeners.set(name, listener),
        removeEventListener: () => undefined,
      },
    },
  );
  const use = module.useNavigation as (mode: string, smooth: boolean) => Nav;
  return {
    render: (mode = "continuous", smooth = false): Nav =>
      hooks.render(() => use(mode, smooth)),
    emit: (name: string, event: unknown): void => {
      listeners.get(name)!(event);
    },
  };
}

const START = { x: "start", y: "start" };
/** The viewer's own corner: a fraction of the viewer, not the padded start. */
const CORNER = { x: 0, y: 0 };
const point = (x: number, y: number) => ({ x, y, width: 0, height: 0 });
const choices = {
  pageLayout: "single",
  scrollMode: "continuous",
  scrollDirection: "vertical",
} as const;

test("a location goes to its page, to a point on it, or to its box near the top, which is flashed", () => {
  const { stage, calls } = fakeStage();
  const view = harness(stage);
  const nav = view.render();
  nav.show({ page: 4 });
  nav.show({ page: 99 });
  nav.show({ page: 2 }, 120);
  nav.show({ page: 2 }, undefined, 30);
  nav.goToPage(6, 15);
  nav.show({
    page: 5,
    viewRect: { left: 72, top: 83, width: 134, height: 21 },
  });
  const reveal = (page: number, rect: unknown, align: unknown) => [
    "reveal",
    page,
    { rect, align, zoom: "keep", behavior: "instant" },
  ];
  assert.deepEqual(calls, [
    ["goToPage", 3, { behavior: "instant" }],
    ["goToPage", 9, { behavior: "instant" }],
    reveal(1, point(0, 120), CORNER),
    reveal(1, point(30, 0), CORNER),
    reveal(5, point(0, 15), CORNER),
    reveal(4, point(72, 83), { x: "start", y: 0.2 }),
  ]);
  const flashed = view.render().highlight;
  assert.equal(flashed?.page, 5);
  assert.deepEqual([...flashed!.rect], [72, 83, 206, 104]);
});

test("moves animate in continuous scrolling with smooth motion only, and never when asked for at once", () => {
  const { stage, calls } = fakeStage();
  const view = harness(stage);
  view.render("continuous", true).show({ page: 2 });
  view.render("continuous", true).show({ page: 2 }, undefined, 0, true);
  view.render("paged", true).show({ page: 2 });
  view.render("continuous", false).show({ page: 2 });
  assert.deepEqual(
    calls.map(([, , options]) => (options as { behavior: string }).behavior),
    ["smooth", "instant", "instant", "instant"],
  );
});

test("restoring puts the page and the corner back at once, with a number zoom in the same move", () => {
  const { stage, calls } = fakeStage({ pages: 5 });
  const nav = harness(stage).render();
  const position = { ...choices, page: 3, top: 40, left: 8 };
  nav.restore({ ...position, zoom: 150 });
  nav.restore({ ...position, zoom: "actual", page: 9 });
  assert.deepEqual(calls, [
    [
      "reveal",
      2,
      {
        rect: point(8, 40),
        align: CORNER,
        zoom: { level: 1.5 },
        behavior: "instant",
      },
    ],
    [
      "reveal",
      4,
      {
        rect: point(8, 40),
        align: CORNER,
        zoom: { level: 1 },
        behavior: "instant",
      },
    ],
  ]);
});

test("restoring in a fit mode switches to it only when laid out in another, then keeps the zoom", () => {
  const position = {
    ...choices,
    page: 2,
    top: 0,
    left: 0,
    zoom: "fitPage",
  } as const;
  const keep = {
    rect: point(0, 0),
    align: CORNER,
    zoom: "keep",
    behavior: "instant",
  };
  const other = fakeStage({ zoomMode: "custom" });
  harness(other.stage).render().restore(position);
  assert.deepEqual(other.calls, [
    ["zoomTo", { mode: "fit-page" }],
    ["reveal", 1, keep],
  ]);
  const same = fakeStage({ zoomMode: "fit-page" });
  harness(same.stage).render().restore(position);
  assert.deepEqual(same.calls, [["reveal", 1, keep]]);
  // Before the first layout the Stage still has the mode it was registered with.
  const early = fakeStage({ zoomMode: "custom", laidOut: false });
  harness(early.stage).render().restore(position);
  assert.deepEqual(early.calls, [["reveal", 1, keep]]);
});

test("a search match is scrolled to the middle of the viewer without a flash", () => {
  const { stage, calls } = fakeStage();
  const view = harness(stage);
  view.render().reveal(3, [10, 20, 110, 40]);
  assert.deepEqual(calls, [
    [
      "reveal",
      2,
      {
        rect: { x: 10, y: 20, width: 100, height: 20 },
        align: { x: "center", y: "center" },
        zoom: "keep",
        behavior: "instant",
      },
    ],
  ]);
  assert.equal(view.render().highlight, undefined);
});

test("a step turns to the next or previous page, and does nothing past either end", () => {
  const { stage, calls } = fakeStage({ currentPages: [4] });
  const view = harness(stage);
  view.render("continuous", true).step(1);
  view.render("continuous", true).step(-1);
  view.render("paged", true).step(1);
  assert.deepEqual(calls, [
    ["nextPage", { behavior: "smooth" }],
    ["previousPage", { behavior: "smooth" }],
    ["nextPage", { behavior: "instant" }],
  ]);
  const last = fakeStage({ canGoNext: false, canGoPrevious: false });
  const end = harness(last.stage).render();
  end.step(1);
  end.step(-1, true);
  assert.deepEqual(last.calls, []);
});

test("a step keeping the place reveals the corner's point on the page turned to, at once", () => {
  const { stage, calls } = fakeStage({
    currentPages: [4],
    destination: { kind: "xyz", page: {}, x: 10, y: 200, zoom: null },
  });
  harness(stage).render("continuous", true).step(1, true);
  assert.deepEqual(calls, [
    ["nextPage", { behavior: "instant" }],
    [
      "reveal",
      5,
      { rect: point(10, 200), align: START, zoom: "keep", behavior: "instant" },
    ],
  ]);
  // At the top of its page, the corner has no place to keep: a plain turn.
  const top = fakeStage({
    destination: { kind: "xyz", page: {}, x: 0, y: 0, zoom: null },
  });
  harness(top.stage).render().step(1, true);
  assert.deepEqual(top.calls, [["nextPage", { behavior: "instant" }]]);
});

test("the page shown is the one the reader went to, even in a spread", () => {
  const spread = fakeStage({
    currentPages: [4, 5],
    cursor: 5,
    canGoPrevious: false,
  });
  const nav = harness(spread.stage).render();
  assert.equal(nav.currentPage, 6);
  assert.equal(nav.pageCount, 10);
  assert.equal(nav.canGoBack, false);
  assert.equal(nav.canGoForward, true);
  assert.equal(nav.isReady(), true);
  assert.equal(
    harness(fakeStage({ laidOut: false }).stage)
      .render()
      .isReady(),
    false,
    "not before the first layout",
  );
});

test("real navigation input distinguishes reader movement from search controls", () => {
  const view = harness(fakeStage().stage);
  const { intent } = view.render();
  assert.equal(intent.readerRevision(), 0);
  view.emit("pointerdown", { target: new Element("button") });
  view.emit("keydown", new KeyboardEvent("ArrowRight", new Element("input")));
  assert.equal(intent.current(), 2);
  assert.equal(intent.readerRevision(), 0);
  view.emit("wheel", { target: new Element("viewport") });
  view.emit("pointerdown", { target: new Element("viewport") });
  view.emit("touchstart", { target: new Element("viewport") });
  view.emit("keydown", new KeyboardEvent("PageDown", new Element("button")));
  assert.equal(intent.current(), 6);
  assert.equal(intent.readerRevision(), 4);
});
