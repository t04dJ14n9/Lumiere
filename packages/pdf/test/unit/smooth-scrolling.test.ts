import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WheelGesture,
  wheelPixels,
  wheelTarget,
} from "../../src/shared/smooth-motion";
import { resolveSmoothScrolling } from "../../src/shared/view-settings";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

class Element {
  constructor(
    private readonly inViewport: boolean,
    private readonly inNoteCard = false,
  ) {}
  closest(selector: string): Element | null {
    if (selector === ".note-card") {
      return this.inNoteCard ? this : null;
    }
    return selector === ".viewport" && this.inViewport ? this : null;
  }
}

/** The real note-card-target.ts, over this file's elements. */
const noteCardTarget = loadHook(
  "note-card-target.ts",
  {},
  {
    Element,
    Node: class {},
  },
);

/** A Stage that scrolls from `top`/`left`, recording each scroll it is asked for. */
function fakeStage(view = { top: 200, left: 50 }) {
  const scrolls: Record<string, unknown>[] = [];
  const stops: string[] = [];
  let moving = false;
  let motionEnded: () => void = () => undefined;
  const stage = {
    getScrollMetrics: () => ({
      scrollTop: view.top,
      scrollLeft: view.left,
      scrollHeight: 2000,
      scrollWidth: 1500,
      clientHeight: 600,
      clientWidth: 800,
    }),
    isMoving: () => moving,
    stopMotion: () => {
      stops.push("stop");
      moving = false;
    },
    onMotionEnded: (listener: () => void) => {
      motionEnded = listener;
      return () => undefined;
    },
    scrollTo: (options: Record<string, unknown>) => {
      scrolls.push(
        JSON.parse(JSON.stringify(options)) as Record<string, unknown>,
      );
      moving = options.behavior === "smooth";
    },
  };
  return {
    stage,
    scrolls,
    stops,
    endMotion: () => {
      moving = false;
      motionEnded();
    },
  };
}

interface Wheel {
  deltaY: number;
  deltaX: number;
  deltaMode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  timeStamp: number;
  target: Element;
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

function wheel(patch: Partial<Wheel> = {}): Wheel {
  return {
    deltaY: 100,
    deltaX: 0,
    deltaMode: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    timeStamp: 0,
    target: new Element(true),
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...patch,
  };
}

function attach(
  options: {
    smooth?: boolean;
    direction?: string;
    mode?: string;
    stage?: unknown;
  } = {},
) {
  const hooks = fakeReact();
  const listeners = new Map<string, (event: unknown) => void>();
  const container = {
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const module = loadHook(
    "smooth-scrolling.ts",
    {
      react: hooks.react,
      "../shared/smooth-motion": { WheelGesture, wheelPixels, wheelTarget },
      "../shared/view-settings": { resolveSmoothScrolling },
      "./stage-capability": { useStageApi: () => options.stage },
      "./note-card-target": noteCardTarget,
    },
    { Element, window: { matchMedia: () => ({ matches: false }) } },
  );
  const use = module.useSmoothWheel as (...args: unknown[]) => void;
  hooks.render(() =>
    use(
      { current: container },
      options.smooth ?? true,
      options.direction ?? "vertical",
      options.mode ?? "continuous",
    ),
  );
  return {
    wheel: (event: Wheel): void => listeners.get("wheel")?.(event),
    emit: (name: string): void => listeners.get(name)?.({}),
    listening: () => listeners.has("wheel"),
  };
}

test("a mouse notch animates one notch further, and takes the event from the Stage", () => {
  const { stage, scrolls } = fakeStage();
  const view = attach({ stage });
  const notch = wheel();
  view.wheel(notch);
  assert.deepEqual(scrolls, [{ top: 300, behavior: "smooth" }]);
  assert.equal(notch.prevented, true);
  assert.equal(
    notch.stopped,
    true,
    "the Stage's own wheel handler never sees it",
  );
});

// A note card sits in the Stage's overlay, inside the viewport: a long note
// scrolls in it, and the pages under it stay where they are.
test("a notch over a note card is the card's, not the pages'", () => {
  const { stage, scrolls } = fakeStage();
  const view = attach({ stage });
  const notch = wheel({ target: new Element(true, true) });
  view.wheel(notch);
  assert.deepEqual(scrolls, []);
  assert.equal(notch.prevented, false, "the card scrolls as the browser does");
});

test("notches during an animation add up from where it is headed; a reversal starts from where the view is", () => {
  const { stage, scrolls } = fakeStage();
  const view = attach({ stage });
  view.wheel(wheel({ timeStamp: 0 }));
  view.wheel(wheel({ timeStamp: 40 }));
  view.wheel(wheel({ timeStamp: 80 }));
  view.wheel(wheel({ timeStamp: 120, deltaY: -100 }));
  assert.deepEqual(
    scrolls.map((scroll) => scroll.top),
    [300, 400, 500, 100],
  );
});

test("the scroll stops at the end of the document", () => {
  const { stage, scrolls } = fakeStage({ top: 1350, left: 0 });
  attach({ stage }).wheel(wheel({ deltaY: 300 }));
  assert.deepEqual(scrolls, [{ top: 1400, behavior: "smooth" }]);
});

test("pixel input, zoom wheels and wheels outside the pages are left to the Stage", () => {
  const { stage, scrolls } = fakeStage();
  const view = attach({ stage });
  const trackpad = wheel({ deltaY: 7, timeStamp: 1_000 });
  view.wheel(trackpad);
  const zoom = wheel({ ctrlKey: true, timeStamp: 2_000 });
  view.wheel(zoom);
  const outside = wheel({ target: new Element(false), timeStamp: 3_000 });
  view.wheel(outside);
  assert.deepEqual(scrolls, []);
  for (const event of [trackpad, zoom, outside]) {
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
  }
});

test("without smooth motion a notch is the Stage's, but sideways reading scrolls sideways at once", () => {
  const plain = fakeStage();
  const vertical = attach({ stage: plain.stage, smooth: false });
  const event = wheel();
  vertical.wheel(event);
  assert.deepEqual(plain.scrolls, []);
  assert.equal(event.prevented, false);

  const sideways = fakeStage();
  attach({
    stage: sideways.stage,
    smooth: false,
    direction: "horizontal",
  }).wheel(wheel());
  assert.deepEqual(sideways.scrolls, [{ left: 150, behavior: "instant" }]);

  const shifted = fakeStage();
  attach({ stage: shifted.stage }).wheel(wheel({ shiftKey: true }));
  assert.deepEqual(shifted.scrolls, [{ left: 150, behavior: "smooth" }]);
});

test("in paged scrolling the wheel is left to the Stage, which turns pages at the edge", () => {
  const { stage } = fakeStage();
  assert.equal(attach({ stage, mode: "paged" }).listening(), false);
  assert.equal(attach({ stage }).listening(), true);
});

test("input stops an animation of the wheel's, but not a move that is not its own", () => {
  const { stage, stops, endMotion } = fakeStage();
  const view = attach({ stage });
  view.emit("pointerdown");
  assert.deepEqual(stops, [], "nothing of the wheel's is moving");
  view.wheel(wheel());
  view.emit("keydown");
  assert.deepEqual(stops, ["stop"]);
  view.wheel(wheel({ timeStamp: 1_000 }));
  endMotion();
  view.emit("touchstart");
  assert.deepEqual(stops, ["stop"], "the animation had ended");
});
