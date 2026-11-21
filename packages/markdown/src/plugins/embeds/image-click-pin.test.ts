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

test("the reader's wheel, touch, key or scrollbar press ends a pin still waiting for the image", () => {
  for (const [name, input] of [
    [
      "wheel",
      (scroller: EventTarget) => scroller.dispatchEvent(new Event("wheel")),
    ],
    [
      "touch",
      (scroller: EventTarget) =>
        scroller.dispatchEvent(new Event("touchstart")),
    ],
    [
      "scrollbar",
      (scroller: EventTarget) =>
        scroller.dispatchEvent(new Event("pointerdown")),
    ],
    [
      "key",
      (_scroller: EventTarget, dom: EventTarget) =>
        dom.dispatchEvent(new Event("keydown")),
    ],
  ] as const) {
    const { top, drawn, isDrawn, view, pin, base, frozen, update, measure } =
      setup(false);
    const detach = pin.attach();
    pin.press(drawn, { from: 0, to: 1 });
    pin.update(update(frozen));
    isDrawn.value = false;
    pin.update(update(base));
    measure();
    input(view.scrollDOM, view.dom);
    // The reader's scroll moved the image, drawn now.
    view.scrollDOM.scrollTop = 1080;
    isDrawn.value = true;
    top.value = 220;
    pin.redrawn();
    measure();
    assert.equal(view.scrollDOM.scrollTop, 1080, name);
    detach();
  }
});

test("a press inside the note's content is not a scrollbar press", () => {
  const { top, drawn, isDrawn, view, pin, base, frozen, update, measure } =
    setup(false);
  pin.attach();
  pin.press(drawn, { from: 0, to: 1 });
  pin.update(update(frozen));
  isDrawn.value = false;
  pin.update(update(base));
  measure();
  // A press bubbling up from the content (a target below the scroller).
  const content = new EventTarget();
  const press = new Event("pointerdown");
  Object.defineProperty(press, "target", { value: content });
  view.scrollDOM.dispatchEvent(press);
  isDrawn.value = true;
  top.value = 324;
  pin.redrawn();
  measure();
  assert.equal(view.scrollDOM.scrollTop, 1024);
});
