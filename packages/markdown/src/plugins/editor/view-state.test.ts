import assert from "node:assert/strict";
import test from "node:test";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import type {
  Extension,
  SelectionRange,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createRoot } from "@workshop/core";
import { createViewState } from "./view-state";
import { registerViewPersistence } from "./persistence";
import { ViewContributions } from "./contributions";
import { viewState } from "./protocol";

type ScrollMeasurement = NonNullable<
  Parameters<EditorView["requestMeasure"]>[0]
>;

/**
 * A scroller that, as a browser's, keeps its position between 0 and
 * `maxScrollTop`, and records how it is listened to. Events dispatched on it
 * land outside the text: in a margin, a gutter or on the scrollbar.
 */
class FakeScroller extends EventTarget {
  scrollLeft = 0;
  maxScrollTop = Infinity;
  readonly listened: { type: string; options: unknown }[] = [];
  #scrollTop: number;

  constructor(scrollTop: number) {
    super();
    this.#scrollTop = scrollTop;
  }

  get scrollTop(): number {
    return this.#scrollTop;
  }

  set scrollTop(value: number) {
    this.#scrollTop = Math.min(Math.max(value, 0), this.maxScrollTop);
  }

  getBoundingClientRect() {
    return { top: 0 };
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.listened.push({ type, options });
    super.addEventListener(type, listener, options);
  }
}

/**
 * A panel restored to line 0 at the top, which starts at 720 px. With
 * `codeMirrorAnchors`, its measurements end as CodeMirror's do: the line at
 * the top of the view (the restored one) is held where it was on screen.
 */
function restoredPanel(
  presentation: ReturnType<typeof createViewState>,
  { codeMirrorAnchors = false } = {},
) {
  let state = EditorState.create({
    doc: "note",
    extensions: presentation.restoreScrollPosition,
  });
  const geometry = { top: 720 };
  const scrollDOM = new FakeScroller(600);
  const measures: ScrollMeasurement[] = [];
  const view = {
    get state() {
      return state;
    },
    get documentTop() {
      return -scrollDOM.scrollTop;
    },
    scaleY: 1,
    scrollDOM,
    lineBlockAt: () => geometry,
    requestMeasure(request: ScrollMeasurement) {
      measures.push(request);
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  /** Restore, and let CodeMirror scroll to the restored line. */
  const restore = () => {
    presentation.restoreViewState(
      view,
      viewState.parse({
        anchor: 0,
        head: 0,
        scrollTop: 600,
        scrollAnchor: { from: 0, offset: 0 },
        mode: "livePreview",
      }),
    );
    const handler = state.facet(EditorView.scrollHandler)[0]!;
    assert.equal(
      handler(view, EditorSelection.cursor(0), {
        x: "nearest",
        y: "start",
        xMargin: 0,
        yMargin: 0,
      }),
      true,
    );
  };
  restore();
  let anchoredTop = geometry.top;
  return {
    view,
    geometry,
    scrollDOM,
    restore,
    /**
     * Run CodeMirror's next measurement: the queued pin corrections, and
     * then what is queued to run after it, before the frame is painted.
     */
    async flushMeasurements() {
      for (const request of measures) {
        request.write?.(request.read(view), view);
      }
      if (codeMirrorAnchors) {
        scrollDOM.scrollTop += geometry.top - anchoredTop;
      }
      anchoredTop = geometry.top;
      await Promise.resolve();
    },
  };
}

test("widget scroll input cancels applied restore and queued layout correction only in its panel", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const first = restoredPanel(presentation);
  const second = restoredPanel(presentation);
  const firstTop = first.scrollDOM.scrollTop;
  const secondTop = second.scrollDOM.scrollTop;
  root.emit("editor/scrollInput", first.view);
  first.geometry.top += 60;
  second.geometry.top += 60;
  await first.flushMeasurements();
  await second.flushMeasurements();
  assert.equal(first.scrollDOM.scrollTop, firstTop);
  assert.equal(second.scrollDOM.scrollTop, secondTop + 60);
  await root.dispose();
});

test("scrolling away from a restored line keeps content growing above it from pulling the view back", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  // A wheel over a margin, a scrollbar drag, PageDown outside the text.
  const scrolled = restoredPanel(presentation);
  scrolled.scrollDOM.scrollTop += 300;
  scrolled.scrollDOM.dispatchEvent(new Event("scroll"));
  // CodeMirror measures before the scroll event arrives.
  const measuredFirst = restoredPanel(presentation);
  measuredFirst.scrollDOM.scrollTop += 300;
  for (const panel of [scrolled, measuredFirst]) {
    const readerTop = panel.scrollDOM.scrollTop;
    panel.geometry.top += 60;
    await panel.flushMeasurements();
    panel.scrollDOM.dispatchEvent(new Event("scroll"));
    panel.geometry.top += 60;
    await panel.flushMeasurements();
    assert.equal(panel.scrollDOM.scrollTop, readerTop);
  }
  await root.dispose();
});

test("the restored line stays pinned through its own corrections, even where the browser clamps them", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = restoredPanel(presentation);
  panel.scrollDOM.dispatchEvent(new Event("scroll"));
  panel.geometry.top += 60;
  await panel.flushMeasurements();
  panel.scrollDOM.dispatchEvent(new Event("scroll"));
  assert.equal(panel.scrollDOM.scrollTop, 780);

  // The note below is not measured yet, so it cannot scroll as far as the pin asks.
  panel.scrollDOM.maxScrollTop = 800;
  panel.geometry.top += 40;
  await panel.flushMeasurements();
  panel.scrollDOM.dispatchEvent(new Event("scroll"));
  assert.equal(panel.scrollDOM.scrollTop, 800);

  panel.scrollDOM.maxScrollTop = Infinity;
  panel.geometry.top += 10;
  await panel.flushMeasurements();
  assert.equal(panel.scrollDOM.scrollTop, 830);
  await root.dispose();
});

test("reader input anywhere in the scroller ends the pin, and never makes scrolling wait", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = restoredPanel(presentation);
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    panel.restore();
    const readerTop = panel.scrollDOM.scrollTop;
    panel.scrollDOM.dispatchEvent(new Event(type));
    panel.geometry.top += 60;
    await panel.flushMeasurements();
    assert.equal(panel.scrollDOM.scrollTop, readerTop, type);
  }
  const waitedFor = panel.scrollDOM.listened.filter(
    ({ options }) =>
      typeof options !== "object" ||
      !(options as AddEventListenerOptions).passive,
  );
  assert.deepEqual(waitedFor, []);
  await root.dispose();
});

/** A panel scrolled to 600 px, its top line (at 40) starting 10 px above. */
function scrolledPanel(presentation: ReturnType<typeof createViewState>) {
  let state = EditorState.create({
    doc: "x".repeat(100),
    extensions: presentation.restoreScrollPosition,
  });
  const line = { from: 40, top: 590 };
  const scrollDOM = new FakeScroller(600);
  const dispatched: TransactionSpec[] = [];
  const view = {
    get state() {
      return state;
    },
    get documentTop() {
      return -scrollDOM.scrollTop;
    },
    scaleY: 1,
    scrollDOM,
    lineBlockAt: () => line,
    lineBlockAtHeight: () => line,
    requestMeasure() {},
    dispatch(spec: TransactionSpec) {
      dispatched.push(spec);
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  const scroll = (head: number) =>
    state.facet(EditorView.scrollHandler)[0]!(
      view,
      EditorSelection.cursor(head),
      { x: "nearest", y: "start", xMargin: 0, yMargin: 0 },
    );
  return { view, line, scrollDOM, dispatched, scroll };
}

test("turning a plugin on or off keeps the line at the top of the viewport in place", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = scrolledPanel(presentation);
  let changed = false;
  presentation.keepPlace(panel.view, () => {
    changed = true;
    // Reconfiguring re-estimated the heights above: the line moved up 140 px.
    panel.line.top = 450;
  });
  assert.equal(changed, true);
  assert.equal(panel.dispatched.length, 1);
  assert.equal(panel.scroll(40), true);
  assert.equal(panel.line.top - panel.scrollDOM.scrollTop, -10);

  // Turned back on while layout settles: the same line stays pinned.
  presentation.keepPlace(panel.view, () => (panel.line.top = 520));
  assert.equal(panel.dispatched.length, 2);
  assert.equal(panel.scroll(40), true);
  assert.equal(panel.line.top - panel.scrollDOM.scrollTop, -10);
  await root.dispose();
});

test("keeping the place leaves a view at the top, and a restore on its way, alone", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const top = scrolledPanel(presentation);
  top.scrollDOM.scrollTop = 0;
  presentation.keepPlace(top.view, () => {});
  assert.equal(top.dispatched.length, 0);

  const restoring = scrolledPanel(presentation);
  presentation.restoreViewState(
    restoring.view,
    viewState.parse({
      anchor: 0,
      head: 0,
      scrollTop: 0,
      scrollAnchor: { from: 70, offset: 0 },
      mode: "livePreview",
    }),
  );
  let changed = false;
  presentation.keepPlace(restoring.view, () => (changed = true));
  assert.equal(changed, true);
  assert.equal(restoring.dispatched.length, 1, "only the restore's dispatch");
  // The restore still lands where it was going.
  assert.equal(restoring.scroll(70), true);
  await root.dispose();
});

/**
 * A note whose line at 40 starts 5000 px down, scrolled to the top, with the
 * embedder's controls `inset` px tall, and `spaceAbove` px of space above the
 * line's text (a heading's), unless its row is not drawn (`drawn: false`). A
 * scroll to a line goes through the view's scroll handler, as CodeMirror's
 * measuring does it.
 */
function jumpedPanel(
  presentation: ReturnType<typeof createViewState>,
  { inset = 0, spaceAbove = 0, drawn: initiallyDrawn = true } = {},
) {
  let drawn = initiallyDrawn;
  let state = EditorState.create({
    doc: "x".repeat(100),
    extensions: presentation.restoreScrollPosition,
  });
  const line = { from: 40, top: 5000 };
  const scrollDOM = new FakeScroller(0);
  const measures: ScrollMeasurement[] = [];
  const scrolls: number[] = [];
  // A measure requested without a request, which reading the layout runs.
  let measurePending = false;
  let measured = 0;
  const view = {
    get state() {
      return state;
    },
    dom: {
      ownerDocument: {
        documentElement: {},
        defaultView: {
          getComputedStyle: () => ({
            getPropertyValue: () => `${inset}px`,
            paddingTop: `${spaceAbove}px`,
          }),
        },
      },
    },
    // Only a drawn line has a DOM element, whose padding is the space above.
    get viewport() {
      return drawn ? { from: 0, to: 100 } : { from: 500, to: 600 };
    },
    domAtPos: () => ({
      node: { nodeType: 1, closest: () => ({}) },
    }),
    get documentTop() {
      return -scrollDOM.scrollTop;
    },
    scaleY: 1,
    scrollDOM,
    contentDOM: { className: "cm-content" },
    lineBlockAt: () => line,
    lineBlockAtHeight() {
      if (measurePending) {
        measurePending = false;
        measured++;
      }
      return line;
    },
    requestMeasure(request?: ScrollMeasurement) {
      if (request) {
        measures.push(request);
      } else {
        measurePending = true;
      }
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
      const effects = spec.effects;
      for (const effect of Array.isArray(effects) ? effects : [effects]) {
        const range = (effect as { value?: { range?: SelectionRange } })?.value
          ?.range;
        if (range) {
          scrolls.push(range.head);
          state.facet(EditorView.scrollHandler)[0]!(view, range, {
            x: "nearest",
            y: "start",
            xMargin: 0,
            yMargin: 0,
          });
        }
      }
    },
  } as unknown as EditorView;
  /** CodeMirror's scroll to a line: the handler decides where it goes. */
  const scroll = (head: number) =>
    state.facet(EditorView.scrollHandler)[0]!(
      view,
      EditorSelection.cursor(head),
      { x: "nearest", y: "start", xMargin: 0, yMargin: 0 },
    );
  return {
    view,
    line,
    scrollDOM,
    scrolls,
    scroll,
    /**
     * CodeMirror's measurement after a layout change, which runs the
     * corrections queued so far, and what they queue after it.
     */
    async measure() {
      for (const request of measures) {
        request.write?.(request.read(view), view);
      }
      await Promise.resolve();
    },
    /** The row's line is drawn: its text has a place of its own. */
    draw() {
      drawn = true;
    },
    /** How often CodeMirror measured at once, rather than in the next frame. */
    get measured() {
      return measured;
    },
    /** Where the line's text is on screen, from the top of the viewport. */
    get lineOnScreen() {
      return line.top + (drawn ? spaceAbove : 0) - scrollDOM.scrollTop;
    },
  };
}

test("a held line sits below the top margin and stays there as content grows above it", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = jumpedPanel(presentation);
  presentation.holdAtTop(panel.view, 40, 5);
  assert.equal(panel.scroll(40), true, "the hold takes the scroll");
  assert.equal(panel.lineOnScreen, 5);

  // Features loaded after the jump make the notes above it taller, with
  // CodeMirror's own anchoring not undoing it.
  panel.line.top += 12_000;
  await panel.measure();
  assert.equal(panel.lineOnScreen, 5);
  panel.line.top -= 300;
  await panel.measure();
  assert.equal(panel.lineOnScreen, 5);
  await root.dispose();
});

test("a held line puts its text at the margin, not the space above it", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  // A heading has space above its text inside its line.
  const panel = jumpedPanel(presentation, { spaceAbove: 16 });
  presentation.holdAtTop(panel.view, 40, 5);
  panel.scroll(40);
  assert.equal(panel.lineOnScreen, 5);
  panel.line.top += 900;
  await panel.measure();
  assert.equal(panel.lineOnScreen, 5);
  await root.dispose();
});

test("a line not drawn yet is held by its line's top, and by its text once drawn", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = jumpedPanel(presentation, { spaceAbove: 16, drawn: false });
  presentation.holdAtTop(panel.view, 40, 5);
  panel.scroll(40);
  assert.equal(panel.lineOnScreen, 5, "line top at the margin");

  panel.draw();
  panel.line.top += 40;
  await panel.measure();
  assert.equal(panel.lineOnScreen, 5, "text at the margin");
  await root.dispose();
});

test("a held line is placed below the embedder's controls too", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = jumpedPanel(presentation, { inset: 48 });
  presentation.holdAtTop(panel.view, 40, 22);
  panel.scroll(40);
  assert.equal(panel.lineOnScreen, 70, "inset 48 plus the sticky bar's 22");
  await root.dispose();
});

test("moving a hold puts the line below the sticky bar without letting it go", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = jumpedPanel(presentation);
  const hold = presentation.holdAtTop(panel.view, 40, 5);
  panel.scroll(40);
  assert.equal(hold.isHeld(), true);

  // The sticky bar appeared over the line: hold it 22 px lower.
  assert.equal(hold.move(22), true);
  assert.deepEqual(panel.scrolls, [40], "the move scrolls to the line itself");
  assert.equal(panel.lineOnScreen, 22);
  assert.equal(hold.isHeld(), true);

  // And content then grows above it: still held at the new place.
  panel.line.top += 4_000;
  await panel.measure();
  assert.equal(panel.lineOnScreen, 22);
  await root.dispose();
});

test("moving a hold scrolls at once, in the frame that is being measured, not in the next", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = jumpedPanel(presentation);
  const hold = presentation.holdAtTop(panel.view, 40, 5);
  panel.scroll(40);
  assert.equal(panel.measured, 0);

  // The sticky bar is drawn over the line in the frame of the jump: its
  // correction is measured in that frame too, or the line is painted under
  // the bar first.
  hold.move(22);
  assert.equal(panel.measured, 1, "CodeMirror measured at once");
  assert.equal(panel.lineOnScreen, 22);
  await root.dispose();
});

test("the reader's input ends a hold, and it is not put back", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    const panel = jumpedPanel(presentation);
    const hold = presentation.holdAtTop(panel.view, 40, 5);
    panel.scroll(40);
    panel.scrollDOM.dispatchEvent(new Event(type));
    assert.equal(hold.isHeld(), false, type);
    assert.equal(hold.move(22), false, type);
    assert.deepEqual(panel.scrolls, [], `${type}: no scroll after the reader`);
    panel.line.top += 600;
    await panel.measure();
    assert.equal(panel.lineOnScreen, 605, `${type}: content moves freely`);
  }
  await root.dispose();
});

/** Resize observers the code under test makes, which the test triggers. */
class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  observed: unknown[] = [];
  connected = true;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.made.push(this);
  }
  observe(target: unknown) {
    this.observed.push(target);
  }
  disconnect() {
    this.connected = false;
  }
  /** The browser lays out a resize of what it observes, before painting. */
  resize() {
    if (this.connected) {
      this.callback();
    }
  }
}

test("content resized while a line is held is measured before the frame is painted", async (t) => {
  const global = globalThis as { ResizeObserver?: unknown };
  const original = global.ResizeObserver;
  global.ResizeObserver = FakeResizeObserver;
  t.after(() => {
    global.ResizeObserver = original;
    FakeResizeObserver.made = [];
  });
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = jumpedPanel(presentation);
  presentation.holdAtTop(panel.view, 40, 5);
  const [watcher] = FakeResizeObserver.made;
  assert.deepEqual(watcher?.observed, [panel.view.contentDOM]);
  watcher.resize();
  assert.equal(panel.measured, 0, "not before the jump has scrolled");

  panel.scroll(40);
  // An image above the line gets its size: the frame must not be painted
  // with the line pushed down, so CodeMirror measures (and anchors) now.
  watcher.resize();
  assert.equal(panel.measured, 1);

  panel.scrollDOM.dispatchEvent(new Event("wheel"));
  assert.equal(watcher.connected, false, "the reader took over");
  watcher.resize();
  assert.equal(panel.measured, 1);
  await root.dispose();
});

test("a hold ends when another line is held in the view", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = jumpedPanel(presentation);
  const first = presentation.holdAtTop(panel.view, 40, 5);
  const second = presentation.holdAtTop(panel.view, 70, 5);
  assert.equal(first.isHeld(), false);
  assert.equal(first.move(22), false);
  assert.equal(second.isHeld(), true);
  await root.dispose();
});

test("scroll events coalesce through debounced checkpoint and flush on dispose", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const compartment = new Compartment();
  let state = EditorState.create({
    doc: "line 1\nline 2\nline 3",
    extensions: [compartment.of([])],
  });
  const scrollListeners = new Map<
    string,
    { fn: () => void; options?: unknown }
  >();
  const windowListeners = new Map<string, () => void>();
  const scrollDOM = {
    scrollTop: 0,
    scrollLeft: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener(type: string, fn: () => void, options?: unknown) {
      scrollListeners.set(type, { fn, options });
    },
    removeEventListener(type: string) {
      scrollListeners.delete(type);
    },
  };
  const view = {
    get state() {
      return state;
    },
    get documentTop() {
      return -scrollDOM.scrollTop;
    },
    scaleY: 1,
    scrollDOM,
    dom: {
      ownerDocument: {
        defaultView: {
          addEventListener(type: string, fn: () => void) {
            windowListeners.set(type, fn);
          },
          removeEventListener(type: string) {
            windowListeners.delete(type);
          },
        },
      },
    },
    lineBlockAtHeight: () => ({ from: 7, top: 20 }),
    lineBlockAt: () => ({ from: 7, top: 20 }),
    requestMeasure() {},
  } as unknown as EditorView;
  const contributions = new ViewContributions(view);
  const persisted: unknown[] = [];
  const cleanups: Array<() => void> = [];
  registerViewPersistence(
    {
      effect(fn: () => (() => void) | void) {
        const cleanup = fn();
        if (typeof cleanup === "function") {
          cleanups.push(cleanup);
        }
      },
      emit() {},
      logger: { warn() {}, info() {}, error() {}, debug() {} },
      document: { flush: async () => {} },
      rpc: { handle: () => () => {} },
    } as never,
    {
      view,
      source: "line 1\nline 2\nline 3",
      mode: "livePreview",
      extend(ext: Extension) {
        state = state.update({
          effects: compartment.reconfigure(ext),
        }).state;
        return () => {};
      },
    } as never,
    { presentation, contributions },
    { persist: (saved) => persisted.push(saved) },
  );
  const scrollEntry = scrollListeners.get("scroll");
  assert.ok(scrollEntry);
  assert.deepEqual(scrollEntry.options, { passive: true });
  for (let i = 1; i <= 10; i++) {
    scrollDOM.scrollTop = i * 24;
    scrollEntry.fn();
  }
  // Raw 60-120Hz scroll events must not synchronously call persist()
  assert.equal(persisted.length, 0);
  // Disposing while a scroll checkpoint is pending flushes the latest scrollTop
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  await root.dispose();
  assert.equal(persisted.length, 1);
  assert.equal((persisted[0] as { scrollTop: number }).scrollTop, 240);
});

test("content growing above the restored line is undone once, CodeMirror's anchoring and the pin together", async () => {
  const root = createRoot();
  const presentation = createViewState(root);
  const panel = restoredPanel(presentation, { codeMirrorAnchors: true });
  const restoredTop = panel.scrollDOM.scrollTop;
  // An image above the line loads, 882 px tall.
  panel.geometry.top += 882;
  await panel.flushMeasurements();
  panel.scrollDOM.dispatchEvent(new Event("scroll"));
  assert.equal(panel.scrollDOM.scrollTop, restoredTop + 882);
  // Still pinned: a later change is still held.
  panel.geometry.top += 40;
  await panel.flushMeasurements();
  assert.equal(panel.scrollDOM.scrollTop, restoredTop + 922);
  await root.dispose();
});
