import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import {
  additionalDragVelocity,
  exitedEdge,
  EXIT_OVERSHOOT_PX,
  EXIT_REACH_PX,
  EXIT_SILENCE_MS,
  EXTRA_SPEED_RAMP_MS,
  extraSpeedRamp,
  selectionDragScroll,
  SelectionDragScroll,
} from "./drag-scroll";
import { config } from "./manifest";
import { protocol } from "./protocol";
import { settingsExtensions } from "./settings";

test("drag-scroll config defaults to 4x and validates the same range over RPC", () => {
  for (const schema of [config, protocol.notifications.configureEditor]) {
    assert.equal(schema.parse({}).dragScrollSpeed, 4);
    for (const speed of [1, 2.5, 4, 10]) {
      assert.equal(
        schema.parse({ dragScrollSpeed: speed }).dragScrollSpeed,
        speed,
      );
    }
    for (const speed of [0, 0.99, 10.1, NaN, Infinity, "4", null]) {
      assert.throws(() => schema.parse({ dragScrollSpeed: speed }));
    }
  }
});

test("extra motion multiplies CodeMirror's speed at both edges and beyond", () => {
  assert.equal(additionalDragVelocity(200, 0, 400, 4), 0);
  assert.equal(additionalDragVelocity(7, 0, 400, 4), 0);
  assert.equal(additionalDragVelocity(393, 0, 400, 4), 0);
  for (const speed of [1, 2.5, 4, 10]) {
    for (const overshoot of [0, 10, 100]) {
      const native = (8 + 0.7 * overshoot) / 50;
      assert.equal(
        additionalDragVelocity(400 + overshoot, 0, 400, speed),
        native * (speed - 1),
      );
      assert.equal(
        additionalDragVelocity(-overshoot, 0, 400, speed),
        -native * (speed - 1),
      );
    }
  }
  assert.equal(additionalDragVelocity(6, 0, 400, 4), -0.48);
  assert.equal(additionalDragVelocity(394, 0, 400, 4), 0.48);
  assert.equal(additionalDragVelocity(10, 20, 20, 4), 0);
  assert.equal(additionalDragVelocity(10, 20, 0, 4), 0);
});

test("the selection-style observer defers selection behavior to CodeMirror", () => {
  const state = EditorState.create({ extensions: selectionDragScroll });
  const event = mouse("mousedown");
  let observed: MouseEvent | undefined;
  const view = {
    plugin: () => ({
      start: (value: MouseEvent) => {
        observed = value;
      },
    }),
  } as unknown as EditorView;
  const style = state.facet(EditorView.mouseSelectionStyle)[0]!;
  assert.equal(style(view, event), null);
  assert.equal(observed, event);
});

test("a stationary selection drag scrolls on frames and reads live settings", (t) => {
  const fixture = dragFixture(t);
  fixture.drag.start(mouse("mousedown"));
  fixture.doc.dispatchEvent(mouse("mousemove", { clientX: 200, clientY: 400 }));
  // Past the ramp: the pointer has rested in the zone.
  fixture.clock.now = EXTRA_SPEED_RAMP_MS;
  fixture.frame(0);
  fixture.frame(50);
  assert.equal(fixture.viewport.scrollTop, 531);
  assert.equal(fixture.viewport.scrollLeft, 500);
  fixture.setSpeed(10);
  fixture.frame(100);
  assert.equal(fixture.viewport.scrollTop, 603);
  fixture.setSpeed(1);
  fixture.frame(150);
  assert.equal(fixture.viewport.scrollTop, 603);
  assert.equal(fixture.pending(), 0);
  // CodeMirror continues scrolling at 1x, and its scroll events wake the
  // shared helper even if the pointer has not moved since the config change.
  fixture.setSpeed(4);
  fixture.viewport.dispatchEvent(new Event("scroll"));
  fixture.frame(200);
  assert.ok(fixture.viewport.scrollTop > 603);
});

test("the shared helper scrolls left/up and stops when content disconnects", (t) => {
  const fixture = dragFixture(t);
  fixture.drag.start(mouse("mousedown"));
  fixture.doc.dispatchEvent(mouse("mousemove", { clientX: 0, clientY: 0 }));
  fixture.clock.now = EXTRA_SPEED_RAMP_MS;
  fixture.frame(0);
  fixture.frame(50);
  assert.equal(fixture.viewport.scrollTop, 469);
  assert.equal(fixture.viewport.scrollLeft, 469);
  fixture.content.isConnected = false;
  fixture.frame(100);
  assert.equal(fixture.pending(), 0);
});

for (const ending of [
  "mouseup",
  "pointerup",
  "pointercancel",
  "blur",
  "dragstart",
  "buttonsUp",
  "typing",
  "destroy",
]) {
  test(`selection drag releases frames and listeners on ${ending}`, (t) => {
    const fixture = dragFixture(t);
    fixture.drag.start(mouse("mousedown"));
    fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 400 }));
    fixture.frame(0);
    const before = fixture.viewport.scrollTop;
    if (ending === "buttonsUp") {
      fixture.doc.dispatchEvent(mouse("mousemove", { buttons: 0 }));
    } else if (ending === "typing") {
      fixture.drag.update({
        transactions: [
          { isUserEvent: (type: string) => type === "input.type" },
        ],
      } as unknown as ViewUpdate);
    } else if (ending === "destroy") {
      fixture.drag.destroy();
    } else if (ending === "blur" || ending === "pointerup") {
      fixture.win.dispatchEvent(new Event(ending));
    } else {
      fixture.doc.dispatchEvent(new Event(ending));
    }
    assert.equal(fixture.pending(), 0);
    fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 400 }));
    fixture.viewport.dispatchEvent(new Event("scroll"));
    fixture.frame(50);
    assert.equal(fixture.viewport.scrollTop, before);
    assert.equal(fixture.pending(), 0);
  });
}

test("hover, secondary clicks and editor gestures in another panel do not scroll", (t) => {
  const fixture = dragFixture(t);
  fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 400 }));
  fixture.drag.start(mouse("mousedown", { button: 2 }));
  fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 400 }));
  assert.equal(fixture.pending(), 0);
  const other = new SelectionDragScroll({
    ...fixture.view,
    dom: { ownerDocument: new EventTarget() },
  } as unknown as EditorView);
  t.after(() => other.destroy());
  fixture.drag.start(mouse("mousedown"));
  fixture.drag.destroy();
  other.start(mouse("mousedown"));
  fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 400 }));
  assert.equal(fixture.pending(), 0);
});

function mouse(type: string, values: Partial<MouseEvent> = {}): MouseEvent {
  return Object.assign(
    new Event(type),
    { button: 0, buttons: 1, clientX: 200, clientY: 200 },
    values,
  ) as MouseEvent;
}

function dragFixture(t: TestContext) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { defaultView: win });
  const content = { isConnected: true };
  const viewport = Object.assign(new EventTarget(), {
    isConnected: true,
    clientLeft: 0,
    clientTop: 0,
    clientWidth: 400,
    clientHeight: 400,
    scrollLeft: 500,
    scrollTop: 500,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 400 }),
    scrollBy({ left = 0, top = 0 }: ScrollToOptions) {
      this.scrollLeft += left;
      this.scrollTop += top;
    },
  });
  const settings = new Compartment();
  const view = {
    dom: { ownerDocument: doc },
    scrollDOM: viewport,
    contentDOM: content,
    state: EditorState.create({
      doc: "Selection stays owned by CodeMirror",
      selection: { anchor: 2, head: 8 },
      extensions: settings.of(settingsExtensions({})),
    }),
  };
  const original = view.state;
  const globals = {
    window: win,
    innerWidth: 400,
    innerHeight: 400,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MouseEvent: class extends Event {
      readonly clientX: number;
      readonly clientY: number;
      readonly buttons: number;
      constructor(type: string, init: MouseEventInit = {}) {
        super(type, init);
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
        this.buttons = init.buttons ?? 0;
      }
    },
  };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    descriptors.set(key, descriptor);
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const clock = { now: 0 };
  const drag = new SelectionDragScroll(
    view as unknown as EditorView,
    () => clock.now,
  );
  t.after(() => {
    drag.destroy();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  return {
    drag,
    clock,
    viewport,
    content,
    doc,
    win,
    view,
    pending: () => frames.size,
    frame(time: number) {
      const scheduled = [...frames.values()];
      frames.clear();
      for (const callback of scheduled) {
        callback(time);
      }
    },
    setSpeed(dragScrollSpeed: number) {
      view.state = view.state.update({
        effects: settings.reconfigure(settingsExtensions({ dragScrollSpeed })),
      }).state;
      assert.equal(view.state.doc, original.doc);
      assert.equal(view.state.selection, original.selection);
    },
  };
}

test("a pointer that went silent heading out of the note crossed the edge", () => {
  const bounds = { top: 0, bottom: 400 };
  const at = (y: number, velocityY: number) => ({
    x: 0,
    y,
    time: 0,
    velocityY,
  });
  assert.equal(exitedEdge(at(380, 1), bounds), "bottom", "20 px in 80 ms");
  assert.equal(exitedEdge(at(300, 1), bounds), undefined, "too far to reach");
  assert.equal(
    exitedEdge(at(399, 0), bounds),
    undefined,
    "resting at the edge",
  );
  assert.equal(exitedEdge(at(399, -1), bounds), undefined, "heading back in");
  assert.equal(exitedEdge(at(30, -0.5), bounds), "top");
  assert.equal(exitedEdge(at(30, -0.2), bounds), undefined);
  // In CodeMirror's 6 px zone it already scrolls, and keeps scrolling.
  assert.equal(exitedEdge(at(397, 5), bounds), undefined);
  // A jump toward the middle and a stop is not leaving through the far edge.
  assert.equal(exitedEdge(at(200, -10), bounds), undefined);
  assert.equal(exitedEdge(at(400 - EXIT_REACH_PX, 2), bounds), "bottom");
  assert.equal(exitedEdge(at(399 - EXIT_REACH_PX, 2), bounds), undefined);
});

test("the extra speed ramps in over the zone dwell", () => {
  assert.equal(extraSpeedRamp(0), 0);
  assert.equal(extraSpeedRamp(-5), 0);
  assert.equal(extraSpeedRamp(EXTRA_SPEED_RAMP_MS / 2), 0.5);
  assert.equal(extraSpeedRamp(EXTRA_SPEED_RAMP_MS * 3), 1);
});

test("brushing the zone for a frame does not move the note", (t) => {
  const fixture = dragFixture(t);
  fixture.drag.start(mouse("mousedown"));
  fixture.doc.dispatchEvent(mouse("mousemove", { clientX: 200, clientY: 398 }));
  fixture.frame(0);
  fixture.clock.now = 16;
  fixture.doc.dispatchEvent(mouse("mousemove", { clientX: 200, clientY: 300 }));
  fixture.frame(16);
  assert.equal(fixture.viewport.scrollTop, 500);
});

test("a drag carried out past the bottom edge keeps CodeMirror scrolling as if it saw the pointer", async (t) => {
  const fixture = dragFixture(t);
  const seen: { y: number; buttons: number }[] = [];
  fixture.doc.addEventListener("mousemove", (event) => {
    const move = event as MouseEvent;
    seen.push({ y: move.clientY, buttons: move.buttons });
  });
  fixture.drag.start(mouse("mousedown"));
  fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 300 }));
  fixture.clock.now = 16;
  // 30 px a frame toward the bottom, then nothing: it left the webview.
  fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 360 }));
  await new Promise((resolve) => setTimeout(resolve, EXIT_SILENCE_MS + 40));
  assert.deepEqual(seen.at(-1), {
    y: 400 + EXIT_OVERSHOOT_PX,
    buttons: 1,
  });
  // The extra motion runs at once, at full speed.
  fixture.frame(200);
  fixture.frame(250);
  assert.ok(fixture.viewport.scrollTop > 500);
});

test("a pointer resting near the edge is not taken for one that left", async (t) => {
  const fixture = dragFixture(t);
  const seen: number[] = [];
  fixture.doc.addEventListener("mousemove", (event) =>
    seen.push((event as MouseEvent).clientY),
  );
  fixture.drag.start(mouse("mousedown"));
  fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 360 }));
  fixture.clock.now = 100;
  fixture.doc.dispatchEvent(mouse("mousemove", { clientY: 362 }));
  await new Promise((resolve) => setTimeout(resolve, EXIT_SILENCE_MS + 40));
  assert.deepEqual(seen, [360, 362]);
});
