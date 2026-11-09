import assert from "node:assert/strict";
import { test } from "node:test";
import { keyMove, swappedArrow } from "../../src/shared/paging-keys";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

class Element {
  constructor(private readonly own: boolean) {}
  closest(selector: string): Element | null {
    return this.own && selector.includes("input") ? this : null;
  }
}

interface View {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
}

/** The Stage's scroll metrics for a 800x600 viewer over the given content. */
function fakeStage(view: View) {
  const scrolls: Record<string, unknown>[] = [];
  const stage = {
    getScrollMetrics: () => ({
      ...view,
      clientWidth: 800,
      clientHeight: 600,
      scrollableX: view.scrollWidth > 801,
      scrollableY: view.scrollHeight > 601,
    }),
    scrollBy: (options: Record<string, unknown>) =>
      scrolls.push(
        JSON.parse(JSON.stringify(options)) as Record<string, unknown>,
      ),
  };
  return { stage, scrolls };
}

function press(
  key: string,
  options: {
    stage: unknown;
    mode?: string;
    direction?: string;
    keepPlace?: boolean;
    target?: Element;
    modifiers?: Record<string, boolean>;
  },
) {
  const hooks = fakeReact();
  const steps: unknown[][] = [];
  let listener: (event: unknown) => void = () => undefined;
  const module = loadHook(
    "paging-input.ts",
    {
      react: hooks.react,
      "../shared/paging-keys": { keyMove, swappedArrow },
      "./reading-position": {
        currentViewSettings: () => ({
          arrowsKeepPlace: options.keepPlace ?? false,
        }),
      },
      "./stage-capability": { useStageApi: () => options.stage },
    },
    {
      Element,
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
      mode: options.mode ?? "continuous",
      direction: options.direction ?? "vertical",
      step: (...args: unknown[]) => steps.push(args),
    }),
  );
  const event = {
    key,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: options.target ?? new Element(false),
    ...options.modifiers,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  listener(event);
  return { event, steps };
}

const middle = {
  scrollTop: 300,
  scrollLeft: 0,
  scrollHeight: 3000,
  scrollWidth: 800,
};

test("an arrow pans the Stage by up to the room it has", () => {
  const { stage, scrolls } = fakeStage(middle);
  const { event } = press("ArrowDown", { stage });
  assert.deepEqual(scrolls, [{ left: 0, top: 40, behavior: "instant" }]);
  assert.equal(event.prevented, true);
  const near = fakeStage({ ...middle, scrollTop: 2395 });
  press("ArrowDown", { stage: near.stage });
  assert.deepEqual(near.scrolls, [{ left: 0, top: 5, behavior: "instant" }]);
  const sideways = fakeStage({ ...middle, scrollWidth: 2000, scrollLeft: 500 });
  press("ArrowLeft", { stage: sideways.stage });
  assert.deepEqual(sideways.scrolls, [
    { left: -40, top: 0, behavior: "instant" },
  ]);
});

test("Page Down pans most of a screen along the reading direction, then turns the page when paged", () => {
  const { stage, scrolls } = fakeStage(middle);
  press("PageDown", { stage });
  assert.deepEqual(scrolls, [{ left: 0, top: 525, behavior: "instant" }]);
  const end = fakeStage({ ...middle, scrollTop: 2400 });
  const paged = press("PageDown", { stage: end.stage, mode: "paged" });
  assert.deepEqual(end.scrolls, []);
  assert.deepEqual(paged.steps, [[1]]);
  assert.equal(paged.event.prevented, true);
});

test("out of room in continuous scrolling an arrow does not turn the page, but Left/Right do when the page fits across", () => {
  const { stage, scrolls } = fakeStage({ ...middle, scrollTop: 2400 });
  const down = press("ArrowDown", { stage });
  assert.deepEqual(down.steps, []);
  assert.equal(down.event.prevented, false);
  const right = press("ArrowRight", { stage });
  assert.deepEqual(right.steps, [[1]]);
  assert.deepEqual(scrolls, []);
});

test("with arrowsKeepPlace a plain Left/Right turns the page keeping the place", () => {
  const { stage, scrolls } = fakeStage(middle);
  const { event, steps } = press("ArrowLeft", { stage, keepPlace: true });
  assert.deepEqual(steps, [[-1, true]]);
  assert.equal(event.prevented, true);
  assert.deepEqual(scrolls, []);
});

test("modified keys, keys of fields and menus, and handled keys are left alone", () => {
  const { stage, scrolls } = fakeStage(middle);
  const modified = press("ArrowDown", { stage, modifiers: { metaKey: true } });
  const field = press("ArrowDown", { stage, target: new Element(true) });
  const handled = press("ArrowDown", {
    stage,
    modifiers: { defaultPrevented: true },
  });
  assert.deepEqual(scrolls, []);
  for (const { event, steps } of [modified, field, handled]) {
    assert.equal(event.prevented, false);
    assert.deepEqual(steps, []);
  }
});
