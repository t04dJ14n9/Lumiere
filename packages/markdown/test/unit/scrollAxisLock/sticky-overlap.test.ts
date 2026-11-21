import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { WheelRails } from "../../../src/plugins/scrollAxisLock/wheel-rails";
import { StickyScrollView } from "../../../src/plugins/stickyScroll/view";

/** The pinned headings' overlay: its own wheel listener cancels, as the real one does. */
class Pin extends EventTarget {
  className = "";
  hidden = false;
  setAttribute() {}
  removeAttribute() {}
  append() {}
  remove() {}
}

/**
 * The editor's root, with a pin inside it. A wheel over the pin reaches the
 * root's capture listeners first, then the pin's own. As in the DOM,
 * `preventDefault` does nothing inside a passive listener.
 */
class Root extends EventTarget {
  readonly ownerDocument = { createElement: () => new Pin() };
  append() {}
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const given = options as AddEventListenerOptions;
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
}

let time = 20_000;

function wheelOverPin(root: Root, pin: Pin, delta: [number, number]): Event {
  const event = new Event("wheel", { cancelable: true });
  time += 16;
  Object.defineProperties(event, {
    timeStamp: { value: time },
    deltaX: { value: delta[0] },
    deltaY: { value: delta[1] },
    deltaMode: { value: 0 },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
    target: { value: pin },
  });
  root.dispatchEvent(event);
  pin.dispatchEvent(event);
  return event;
}

function setup(t: TestContext) {
  const root = new Root();
  const scrolled: [number, number][] = [];
  const scroller = {
    parentElement: null,
    clientWidth: 800,
    clientHeight: 600,
    scrollWidth: 800,
    scrollHeight: 9000,
    scrollLeft: 0,
    scrollTop: 0,
    // The pins' handler scrolls by both axes, the rails by one option.
    scrollBy(x?: ScrollToOptions | number, y?: number) {
      if (typeof x === "number") {
        scrolled.push([x, y ?? 0]);
      } else {
        scrolled.push([x?.left ?? 0, x?.top ?? 0]);
      }
    },
  };
  const view = {
    state: EditorState.create({ doc: "# Root" }),
    dom: root,
    scrollDOM: scroller,
    defaultLineHeight: 24,
    requestMeasure() {},
  };
  const sticky = new StickyScrollView(view as unknown as EditorView, () => {});
  const pin = sticky.dom as unknown as Pin;
  const rails = new WheelRails({
    dom: root as unknown as HTMLElement,
    scroller,
    lineHeight: () => 24,
    beforeFrame: () => {},
    overflowOf: () => "auto",
  });
  rails.start();
  t.after(() => {
    rails.stop();
    sticky.destroy();
  });
  return { root, pin, scrolled };
}

test("over the pinned headings every wheel of a locked gesture scrolls the note once, by one of the two handlers", (t) => {
  const { root, pin, scrolled } = setup(t);
  // The first event is cancelable, but the axis lock's listener is passive
  // for it: the pins' handler scrolls the note, and the axis lock does not.
  const first = wheelOverPin(root, pin, [3, 40]);
  assert.equal(first.defaultPrevented, true, "the pins took it");
  assert.deepEqual(scrolled, [[3, 40]]);
  // From the next event the axis lock cancels it and scrolls along the axis,
  // and the pins' handler leaves the cancelled wheel alone.
  const second = wheelOverPin(root, pin, [3, 40]);
  assert.equal(second.defaultPrevented, true);
  assert.deepEqual(scrolled, [
    [3, 40],
    [0, 40],
  ]);
  wheelOverPin(root, pin, [-2, 35]);
  assert.deepEqual(scrolled.at(-1), [0, 35]);
  assert.equal(scrolled.length, 3);
});

test("a diagonal wheel over the pinned headings is theirs, whole, as before", (t) => {
  const { root, pin, scrolled } = setup(t);
  wheelOverPin(root, pin, [30, 30]);
  wheelOverPin(root, pin, [30, 30]);
  assert.deepEqual(scrolled, [
    [30, 30],
    [30, 30],
  ]);
});
