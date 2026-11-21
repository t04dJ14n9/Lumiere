import assert from "node:assert/strict";
import { test } from "node:test";
import { AxisLock } from "@workshop/scroll/axis-lock";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

class Element {
  closest(selector: string): Element | null {
    return selector === ".viewport" ? this : null;
  }
}

const viewSettings: { predominantAxis?: boolean } = {};
const axisLockedWheel = loadHook("axis-locked-wheel.ts", {
  "@workshop/scroll/axis-lock": { AxisLock },
  "./reading-position": { currentViewSettings: () => viewSettings },
});

function attach() {
  const pans: [number, number][] = [];
  const hooks = fakeReact();
  const listeners = new Map<string, (event: unknown) => void>();
  const module = loadHook(
    "paged-wheel.ts",
    {
      react: hooks.react,
      "./axis-locked-wheel": axisLockedWheel,
      "./note-card-target": { scrollsNoteCard: () => false },
      "./stage-capability": {
        useStageApi: () => ({
          panBy: (dx: number, dy: number) => pans.push([dx, dy]),
        }),
      },
    },
    { Element },
  );
  const container = {
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  hooks.render(() =>
    (module.usePagedWheel as (...args: unknown[]) => void)(
      { current: container },
      "paged",
    ),
  );
  return {
    pans,
    wheel(patch: Record<string, unknown>) {
      const event = {
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        timeStamp: 0,
        cancelable: true,
        target: new Element(),
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
        stopPropagation() {},
        ...patch,
      };
      listeners.get("wheel")!(event);
      return event;
    },
  };
}

test("a paged swipe that is nearly straight pans the page along its axis only", () => {
  viewSettings.predominantAxis = true;
  const view = attach();
  view.wheel({ deltaX: 4, deltaY: 30, timeStamp: 1_000 });
  view.wheel({ deltaX: -5, deltaY: 28, timeStamp: 1_016 });
  assert.deepEqual(view.pans, [
    [-0, -30],
    [-0, -28],
  ]);
  view.wheel({ deltaX: 30, deltaY: 4, timeStamp: 5_000 });
  assert.deepEqual(view.pans.at(-1), [-30, -0]);
});

test("a diagonal swipe, a Shift wheel and a swipe with the setting off pan whole", () => {
  viewSettings.predominantAxis = true;
  const view = attach();
  view.wheel({ deltaX: 20, deltaY: 20, timeStamp: 1_000 });
  view.wheel({ deltaX: 3, deltaY: 40, timeStamp: 3_000, shiftKey: true });
  assert.deepEqual(view.pans, [
    [-20, -20],
    [-40, -3],
  ]);
  viewSettings.predominantAxis = false;
  const off = attach();
  off.wheel({ deltaX: 4, deltaY: 30, timeStamp: 1_000 });
  viewSettings.predominantAxis = true;
  assert.deepEqual(off.pans, [[-4, -30]]);
});

test("a pinch is left to the Stage and a wheel the browser already scrolls is not taken", () => {
  viewSettings.predominantAxis = true;
  const view = attach();
  const pinch = view.wheel({ deltaX: 3, deltaY: 40, ctrlKey: true });
  const late = view.wheel({ deltaX: 3, deltaY: 40, cancelable: false });
  assert.deepEqual(view.pans, []);
  assert.equal(pinch.prevented, false);
  assert.equal(late.prevented, false);
});
