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
  const measures: { read(): unknown; write(value: unknown): void }[] = [];
  const view = {
    scaleY: 1,
    scrollDOM: { scrollTop: 1000 },
    requestMeasure(request: (typeof measures)[number]) {
      measures.push(request);
    },
  };
  const pin = new ClickedImagePin(view as unknown as EditorView, () => [drawn]);
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
  return { top, drawn, view, pin, base, frozen, update, measure };
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
