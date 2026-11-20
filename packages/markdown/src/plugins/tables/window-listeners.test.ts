import test from "node:test";
import assert from "node:assert/strict";
import { TableHandles } from "./handles";
import { TableSelectionDrag } from "./selection-drag";

/** A window that counts its live listeners. */
function countingWindow() {
  const target = new EventTarget();
  let live = 0;
  const add = target.addEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {
    live++;
    const signal = typeof options === "object" ? options.signal : undefined;
    signal?.addEventListener("abort", () => live--, { once: true });
    add(type, listener, options);
  };
  return { target, live: () => live };
}

function withGlobals(globals: Record<string, unknown>, run: () => void): void {
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  try {
    run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  }
}

function fakeElement() {
  return Object.assign(new EventTarget(), {
    hidden: false,
    style: {},
    classList: { add() {}, remove() {} },
    dataset: {} as Record<string, string>,
    append() {},
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
  });
}

const pointer = {
  pointerId: 1,
  clientX: 0,
  clientY: 0,
  detail: 1,
  button: 0,
  isPrimary: true,
  preventDefault() {},
  stopPropagation() {},
} as unknown as PointerEvent;

test("a table adds window listeners only while a selection drag runs", () => {
  const window = countingWindow();
  withGlobals({ window: window.target }, () => {
    const root = fakeElement() as unknown as HTMLElement;
    const drag = new TableSelectionDrag(
      root,
      { rows: [] } as unknown as HTMLTableElement,
      { vertical: root, horizontal: root },
      { select() {}, finish() {} },
    );
    assert.equal(window.live(), 0);
    drag.begin(pointer, { row: 0, column: 0 }, undefined, false);
    assert.ok(window.live() > 0);
    window.target.dispatchEvent(
      Object.assign(new Event("pointerup"), { pointerId: 1 }),
    );
    assert.equal(window.live(), 0);
    drag.begin(pointer, { row: 0, column: 0 }, undefined, true);
    drag.destroy();
    assert.equal(window.live(), 0);
  });
});

test("a table adds window listeners only while a grip is dragged", () => {
  const window = countingWindow();
  const document = { createElement: () => fakeElement() };
  withGlobals({ window: window.target, document }, () => {
    const root = fakeElement() as unknown as HTMLElement;
    const table = {
      rows: [],
      querySelectorAll: () => [],
    } as unknown as HTMLTableElement;
    const handles = new TableHandles(
      root,
      table,
      { vertical: root, horizontal: root },
      { select() {}, move() {}, menu() {} },
    );
    assert.equal(window.live(), 0);
    const button = Object.assign(fakeElement(), {
      dataset: { axis: "row", index: "1" },
    });
    (
      handles as unknown as {
        beginDrag(event: PointerEvent, button: unknown, actions: unknown): void;
      }
    ).beginDrag(pointer, button, { select() {}, move() {}, menu() {} });
    assert.ok(window.live() > 0);
    handles.cancel();
    assert.equal(window.live(), 0);
    handles.destroy();
  });
});
