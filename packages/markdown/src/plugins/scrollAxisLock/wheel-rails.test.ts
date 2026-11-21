import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";
import { GESTURE_GAP_MS } from "@workshop/scroll/axis-lock";
import type { Scroller } from "./scroll-route";
import { WheelRails } from "./wheel-rails";

type Registration = { passive: boolean; live: () => boolean };

/**
 * The editor's root element, recording how each listener was registered. As in
 * the DOM, `preventDefault` does nothing inside a passive listener, whatever
 * the event: `defaultPrevented` stays false.
 */
class FakeDom extends EventTarget {
  readonly registrations: Registration[] = [];

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const given = options as AddEventListenerOptions;
    this.registrations.push({
      passive: given.passive === true,
      live: () => given.signal?.aborted !== true,
    });
    const heard = listener as (event: Event) => void;
    super.addEventListener(
      type,
      given.passive === true
        ? (event: Event) => {
            const prevent = event.preventDefault;
            event.preventDefault = () => {};
            try {
              heard(event);
            } finally {
              event.preventDefault = prevent;
            }
          }
        : heard,
      options,
    );
  }

  /** How the wheel listener now registered is, as the browser would see it. */
  get passive(): boolean | undefined {
    return this.registrations.filter((entry) => entry.live()).at(-1)?.passive;
  }

  get listeners(): number {
    return this.registrations.filter((entry) => entry.live()).length;
  }
}

interface FakeScroller extends Scroller {
  by: ScrollToOptions[];
}

function scroller(
  parent: FakeScroller | null,
  measure: {
    width?: number;
    height?: number;
    overflowX?: number;
    overflowY?: number;
  } = {},
): FakeScroller {
  const node: FakeScroller = {
    by: [],
    parentElement: parent,
    clientWidth: measure.width ?? 800,
    clientHeight: measure.height ?? 600,
    scrollWidth: (measure.width ?? 800) + (measure.overflowX ?? 0),
    scrollHeight: (measure.height ?? 600) + (measure.overflowY ?? 0),
    scrollLeft: 0,
    scrollTop: 0,
    scrollBy(options?: ScrollToOptions | number) {
      const move = options as ScrollToOptions;
      node.by.push(move);
      node.scrollLeft += move.left ?? 0;
      node.scrollTop += move.top ?? 0;
    },
  };
  return node;
}

function setup(t: TestContext, options: { overflowY?: number } = {}) {
  const dom = new FakeDom();
  const note = scroller(null, { overflowY: options.overflowY ?? 9000 });
  const table = scroller(note, { overflowX: 1200 });
  (table as { scrollTop: number }).scrollTop = 0;
  const frames: (() => void)[] = [];
  const clock = { time: 1000 };
  const rails = new WheelRails({
    dom: dom as unknown as HTMLElement,
    scroller: note,
    lineHeight: () => 24,
    now: () => clock.time,
    beforeFrame: (callback) => frames.push(callback),
    overflowOf: (element, axis) => {
      if (element === note) {
        return "auto";
      }
      return element === table && axis === "x" ? "auto" : "hidden";
    },
  });
  rails.start();
  // A fake clock never reaches a gesture's pause, so a timer left running
  // would run for ever.
  t.after(() => rails.stop());
  return { dom, note, table, rails, frames, clock };
}

let time = 0;
function wheel(
  target: object,
  delta: { x?: number; y?: number; mode?: number },
  extra: { cancelable?: boolean; ctrlKey?: boolean; at?: number } = {},
): Event {
  const event = new Event("wheel", { cancelable: extra.cancelable ?? false });
  time = extra.at ?? time + 16;
  Object.defineProperties(event, {
    timeStamp: { value: time },
    deltaX: { value: delta.x ?? 0 },
    deltaY: { value: delta.y ?? 0 },
    deltaMode: { value: delta.mode ?? 0 },
    ctrlKey: { value: extra.ctrlKey ?? false },
    metaKey: { value: false },
    shiftKey: { value: false },
    target: { value: target },
  });
  return event;
}

test("a straight swipe, a mouse wheel and a pinch are the browser's, with no listener that could cancel", (t) => {
  const { dom, note, rails } = setup(t);
  dom.dispatchEvent(wheel(note, { y: 40 }, { at: 100 }));
  dom.dispatchEvent(wheel(note, { y: 38 }));
  dom.dispatchEvent(wheel(note, { y: 120 }, { at: 2000 }));
  dom.dispatchEvent(wheel(note, { x: 6, y: 90 }, { ctrlKey: true }));
  assert.equal(dom.passive, true);
  assert.equal(dom.registrations.length, 1);
  assert.deepEqual(note.by, []);
  rails.stop();
});

test("a diagonal gesture scrolls freely: nothing is taken", (t) => {
  const { dom, note } = setup(t);
  for (let index = 0; index < 20; index++) {
    const event = wheel(note, { x: 20, y: 20 }, { cancelable: true });
    dom.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(dom.passive, true);
  assert.deepEqual(note.by, []);
});

test("a gesture locked up and down becomes one that can cancel, and takes the events after the browser's first", (t) => {
  const { dom, note, frames } = setup(t);
  // The browser had the first two before the page could cancel anything.
  const first = wheel(note, { x: 3, y: 40 }, { at: 5000 });
  dom.dispatchEvent(first);
  assert.equal(dom.passive, false, "now a listener that can cancel");
  assert.equal(dom.listeners, 1, "in place of the passive one");
  dom.dispatchEvent(wheel(note, { x: 3, y: 40 }));
  assert.deepEqual(note.by, []);
  assert.equal(
    frames.length,
    2,
    "what each moved across is put back in a frame of its own",
  );
  // From then on the page can cancel, and takes the whole gesture.
  const later = wheel(note, { x: 4, y: 37 }, { cancelable: true });
  dom.dispatchEvent(later);
  assert.equal(later.defaultPrevented, true);
  assert.deepEqual(note.by, [{ top: 37, behavior: "instant" }]);
  const straight = wheel(note, { y: 30 }, { cancelable: true });
  dom.dispatchEvent(straight);
  assert.equal(
    straight.defaultPrevented,
    true,
    "straight events too, once the gesture is ours",
  );
  assert.deepEqual(note.by.at(-1), { top: 30, behavior: "instant" });
  const upward = wheel(note, { x: -2, y: -25 }, { cancelable: true });
  dom.dispatchEvent(upward);
  assert.deepEqual(note.by.at(-1), { top: -25, behavior: "instant" });
});

test("a first event the browser lets the page cancel is still the browser's while the listener is passive", (t) => {
  const { dom, note, frames } = setup(t);
  // Over the pinned headings an event is cancelable from the start, for their
  // own listener's sake; this listener is passive, so cancelling does nothing.
  const first = wheel(note, { x: 3, y: 40 }, { cancelable: true, at: 6000 });
  dom.dispatchEvent(first);
  assert.equal(first.defaultPrevented, false);
  assert.deepEqual(
    note.by,
    [],
    "the browser scrolls it; scrolling it here too would scroll it twice",
  );
  assert.equal(frames.length, 1, "what it moved across is put back instead");
  assert.equal(dom.passive, false, "the next event can be cancelled");
  const next = wheel(note, { x: 3, y: 40 }, { cancelable: true });
  dom.dispatchEvent(next);
  assert.equal(next.defaultPrevented, true);
  assert.deepEqual(note.by, [{ top: 40, behavior: "instant" }]);
});

test("a sideways gesture over a wide table scrolls the table along its axis only", (t) => {
  const { dom, note, table, frames } = setup(t);
  dom.dispatchEvent(wheel(table, { x: 40, y: 3 }, { at: 7000 }));
  assert.equal(dom.passive, false);
  const event = wheel(table, { x: 38, y: 4 }, { cancelable: true });
  dom.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(table.by, [{ left: 38, behavior: "instant" }]);
  assert.deepEqual(
    note.by,
    [],
    "the note does not move for its vertical stray",
  );
  assert.equal(frames.length, 1);
});

test("a vertical gesture over a wide table scrolls the note and never the table", (t) => {
  const { dom, note, table, frames } = setup(t);
  dom.dispatchEvent(wheel(table, { x: 3, y: 40 }, { at: 9000 }));
  // The table was the scroller the browser latched, and panned for the first event.
  table.scrollLeft = 3;
  const event = wheel(table, { x: 3, y: 40 }, { cancelable: true });
  dom.dispatchEvent(event);
  assert.deepEqual(note.by, [{ top: 40, behavior: "instant" }]);
  assert.deepEqual(table.by, []);
  frames.splice(0).forEach((run) => run());
  assert.equal(table.scrollLeft, 0, "what the first events panned is put back");
});

test("line and page deltas are applied in the scroller's own units", (t) => {
  const lines = setup(t);
  lines.dom.dispatchEvent(
    wheel(lines.note, { x: 0.1, y: 1, mode: 1 }, { at: 100 }),
  );
  lines.dom.dispatchEvent(
    wheel(lines.note, { x: 0.1, y: 2, mode: 1 }, { cancelable: true }),
  );
  assert.deepEqual(lines.note.by, [{ top: 48, behavior: "instant" }]);
  const pages = setup(t);
  pages.dom.dispatchEvent(
    wheel(pages.note, { x: 0.02, y: 1, mode: 2 }, { at: 100 }),
  );
  pages.dom.dispatchEvent(
    wheel(pages.note, { x: 0.02, y: 0.5, mode: 2 }, { cancelable: true }),
  );
  assert.deepEqual(pages.note.by, [{ top: 300, behavior: "instant" }]);
});

test("a pause ends the gesture: the listener cannot cancel again, and the next gesture is judged afresh", (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { dom, note, clock } = setup(t);
    dom.dispatchEvent(wheel(note, { x: 3, y: 40 }, { at: 100 }));
    assert.equal(dom.passive, false);
    clock.time += GESTURE_GAP_MS - 20;
    mock.timers.tick(GESTURE_GAP_MS);
    assert.equal(
      dom.passive,
      false,
      "events came within the gap, so it goes on",
    );
    clock.time += 20;
    mock.timers.tick(20);
    assert.equal(dom.passive, true);
    assert.equal(dom.listeners, 1);
    // A diagonal swipe after the pause is not held to the old axis.
    const diagonal = wheel(
      note,
      { x: 30, y: 30 },
      { cancelable: true, at: 5000 },
    );
    dom.dispatchEvent(diagonal);
    assert.equal(diagonal.defaultPrevented, false);
    assert.deepEqual(note.by, []);
  } finally {
    mock.timers.reset();
  }
});

test("a new gesture that starts before the old one's pause ends it", (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { dom, note, clock } = setup(t);
    dom.dispatchEvent(wheel(note, { x: 3, y: 40 }, { at: 100 }));
    assert.equal(dom.passive, false);
    clock.time += 10;
    dom.dispatchEvent(
      wheel(
        note,
        { x: 30, y: 30 },
        { cancelable: true, at: 100 + GESTURE_GAP_MS + 1 },
      ),
    );
    assert.equal(dom.passive, true);
    assert.deepEqual(note.by, []);
  } finally {
    mock.timers.reset();
  }
});

test("a pinch in the middle of a locked gesture leaves it as it was", (t) => {
  const { dom, note } = setup(t);
  dom.dispatchEvent(wheel(note, { x: 3, y: 40 }, { at: 100 }));
  const pinch = wheel(
    note,
    { x: 0, y: -30 },
    { cancelable: true, ctrlKey: true },
  );
  dom.dispatchEvent(pinch);
  assert.equal(pinch.defaultPrevented, false);
  assert.equal(dom.passive, false);
  const event = wheel(note, { x: 2, y: 30 }, { cancelable: true });
  dom.dispatchEvent(event);
  assert.deepEqual(note.by, [{ top: 30, behavior: "instant" }]);
});

test("stopping removes the listener, and starting again is harmless", (t) => {
  const { dom, note, rails } = setup(t);
  rails.start();
  assert.equal(dom.listeners, 1);
  dom.dispatchEvent(wheel(note, { x: 3, y: 40 }, { at: 100 }));
  assert.equal(dom.passive, false);
  rails.stop();
  assert.equal(dom.listeners, 0);
  const event = wheel(note, { x: 3, y: 40 }, { cancelable: true });
  dom.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  rails.start();
  assert.equal(dom.passive, true);
});
