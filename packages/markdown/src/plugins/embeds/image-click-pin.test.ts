import test from "node:test";
import assert from "node:assert/strict";
import { ChangeSet, EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import {
  pointerSelection,
  setPointerSelection,
} from "../../webview/ui/pointer-selection";
import { ClickedImagePin } from "./image-click-pin";

/** An image whose top the test moves, inside a line of text or not. */
function image(top: { value: number }, inLine: boolean) {
  return {
    closest: (selector: string) =>
      selector === ".cm-line" && inLine ? {} : null,
    getBoundingClientRect: () => ({ top: top.value }),
  } as unknown as HTMLImageElement;
}

function setup(inLine: boolean) {
  const top = { value: 300 };
  const drawn = image(top, inLine);
  /** Whether the image is in the editor's DOM (not between two drawings). */
  const isDrawn = { value: true };
  const measures: { read(): unknown; write(value: unknown): void }[] = [];
  const view = {
    scaleY: 1,
    dom: new EventTarget(),
    scrollDOM: Object.assign(new EventTarget(), { scrollTop: 1000 }),
    requestMeasure(request: (typeof measures)[number]) {
      measures.push(request);
    },
  };
  const pin = new ClickedImagePin(view as unknown as EditorView, () =>
    isDrawn.value ? [drawn] : [],
  );
  const base = EditorState.create({ doc: "x", extensions: [pointerSelection] });
  const frozen = base.update({
    effects: setPointerSelection(EditorSelection.single(0)),
  }).state;
  const update = (state: EditorState) =>
    ({ state, changes: ChangeSet.empty(1) }) as unknown as ViewUpdate;
  const measure = () => {
    for (const request of measures.splice(0)) {
      request.write(request.read());
    }
  };
  return { top, drawn, isDrawn, view, pin, base, frozen, update, measure };
}

test("a clicked image alone on its line is scrolled back under the pointer once its source shows", () => {
  const { top, drawn, view, pin, base, frozen, update, measure } = setup(false);
  pin.press(drawn, { from: 0, to: 1 });
  // While the button is down nothing is revealed, so nothing moves.
  pin.update(update(frozen));
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1000);
  // The release shows the source above it: 24 px lower, scrolled back.
  top.value = 324;
  pin.update(update(base));
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1024);
  // Once only: a later move of the image is the reader's own.
  top.value = 400;
  pin.update(update(base));
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1024);
});

test("an image in a line of text is not pinned", () => {
  const { top, drawn, view, pin, base, update, measure } = setup(true);
  pin.press(drawn, { from: 0, to: 1 });
  top.value = 324;
  pin.update(update(base));
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1000);
});

test("an edit while the button is down moves the pinned image's range with it", () => {
  const top = { value: 300 };
  const drawn = image(top, false);
  const asked: { from: number; to: number }[] = [];
  const measures: { read(): unknown; write(value: unknown): void }[] = [];
  const view = {
    scaleY: 1,
    scrollDOM: { scrollTop: 0 },
    requestMeasure(request: (typeof measures)[number]) {
      measures.push(request);
    },
  };
  const pin = new ClickedImagePin(view as unknown as EditorView, (range) => {
    asked.push(range);
    return [drawn];
  });
  const base = EditorState.create({
    doc: "![[a.png]]",
    extensions: [pointerSelection],
  });
  const frozen = base.update({
    effects: setPointerSelection(EditorSelection.single(0)),
  }).state;
  pin.press(drawn, { from: 0, to: 10 });
  // Five characters land before the image while the button is down ...
  pin.update({
    state: frozen,
    changes: ChangeSet.of({ from: 0, insert: "abcde" }, 10),
  } as unknown as ViewUpdate);
  // ... and the release finds the image where it now is.
  pin.update({
    state: base,
    changes: ChangeSet.empty(15),
  } as unknown as ViewUpdate);
  for (const request of measures.splice(0)) {
    request.write(request.read());
  }
  assert.deepEqual(asked, [{ from: 5, to: 15 }]);
});

test("an image that moves a moment after the release, its drawing below the source rendered in a later frame, is still scrolled back", () => {
  const { top, drawn, isDrawn, view, pin, base, frozen, update, measure } =
    setup(false);
  pin.press(drawn, { from: 0, to: 1 });
  pin.update(update(frozen));
  // Released, the image below the source not drawn yet: nothing moves ...
  isDrawn.value = false;
  pin.update(update(base));
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1000);
  // ... then it is drawn, below the source.
  isDrawn.value = true;
  top.value = 324;
  pin.redrawn();
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1024);
});

test("the pin ends when the reader moves on, edits, or after a short while", () => {
  const scenarios: [string, (base: EditorState) => ViewUpdate, number][] = [
    [
      "caret moved away",
      (base) =>
        ({
          state: base.update({ selection: { anchor: 3 } }).state,
          changes: ChangeSet.empty(4),
        }) as unknown as ViewUpdate,
      0,
    ],
    [
      "an edit",
      (base) =>
        ({
          state: base,
          docChanged: true,
          changes: ChangeSet.empty(4),
        }) as unknown as ViewUpdate,
      0,
    ],
    [
      "too late",
      (base) =>
        ({ state: base, changes: ChangeSet.empty(4) }) as unknown as ViewUpdate,
      500,
    ],
  ];
  for (const [name, later, elapsed] of scenarios) {
    const top = { value: 300 };
    const drawn = image(top, false);
    let time = 0;
    const measures: { read(): unknown; write(value: unknown): void }[] = [];
    const view = {
      scaleY: 1,
      scrollDOM: { scrollTop: 1000 },
      requestMeasure: (request: (typeof measures)[number]) =>
        measures.push(request),
    };
    const pin = new ClickedImagePin(
      view as unknown as EditorView,
      () => [drawn],
      () => time,
    );
    const base = EditorState.create({
      doc: "x yz",
      extensions: [pointerSelection],
    });
    pin.press(drawn, { from: 0, to: 1 });
    pin.update({
      state: base,
      changes: ChangeSet.empty(4),
    } as unknown as ViewUpdate);
    time = elapsed;
    top.value = 324;
    pin.update(later(base));
    for (const request of measures.splice(0)) {
      request.write(request.read());
    }
    assert.equal(view.scrollDOM.scrollTop, 1000, name);
  }
});

test("a release that leaves the image where it was ends the pin, so a later scroll of the reader's stands", () => {
  // An image already selected, its source already shown: nothing to undo.
  const { top, drawn, view, pin, base, frozen, update, measure } = setup(false);
  pin.press(drawn, { from: 0, to: 1 });
  pin.update(update(frozen));
  pin.update(update(base));
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1000);
  // The reader scrolls 80 px; CodeMirror draws the content again.
  view.scrollDOM.scrollTop = 1080;
  top.value = 220;
  pin.update(update(base));
  pin.redrawn();
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1080);
});

test("any scroll of the note since the press ends a pin still waiting for the image, whatever made it", () => {
  type Scroller = EventTarget & {
    scrollTop: number;
    scrollBy(x: number, y: number): void;
  };
  const scrolls: [string, (scroller: Scroller) => void][] = [
    // Blink sends a scrollbar press as `mousedown`, with no `pointerdown`.
    [
      "scrollbar drag",
      (scroller) => {
        scroller.dispatchEvent(new Event("mousedown"));
        scroller.scrollTop += 80;
      },
    ],
    // macOS overlay scrollbars: only `scroll`.
    [
      "overlay scrollbar",
      (scroller) => {
        scroller.scrollTop += 80;
        scroller.dispatchEvent(new Event("scroll"));
      },
    ],
    // Sticky scroll's header passes its wheel on with `scrollBy`.
    ["scrollBy from another plugin", (scroller) => scroller.scrollBy(0, 80)],
  ];
  for (const [name, scroll] of scrolls) {
    const { top, drawn, isDrawn, view, pin, base, frozen, update, measure } =
      setup(false);
    const scroller = Object.assign(view.scrollDOM, {
      scrollBy(_x: number, y: number) {
        scroller.scrollTop += y;
      },
    });
    pin.press(drawn, { from: 0, to: 1 });
    pin.update(update(frozen));
    // Released; the image below the source is not drawn yet.
    isDrawn.value = false;
    pin.update(update(base));
    measure();
    scroll(scroller);
    // Drawn now, 24 px lower for its source, and 80 px higher for the scroll.
    isDrawn.value = true;
    top.value = 244;
    pin.redrawn();
    measure();
    assert.equal(view.scrollDOM.scrollTop, 1080, name);
    // And the pin is over: no later drawing scrolls either.
    top.value = 400;
    pin.redrawn();
    measure();
    assert.equal(view.scrollDOM.scrollTop, 1080, name);
  }
});

test("a scroll while the button is down leaves the image where the reader scrolled it", () => {
  const { top, drawn, view, pin, base, frozen, update, measure } = setup(false);
  pin.press(drawn, { from: 0, to: 1 });
  pin.update(update(frozen));
  view.scrollDOM.scrollTop = 1080;
  top.value = 244;
  pin.update(update(base));
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1080);
});
