import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { imagesOf } from "./image-selection";
import { embedOfImage } from "./image-anchor";
import { ClickedImagePin } from "./image-click-pin";

interface Drawn {
  /** Where CodeMirror reports it: the start of its widget. */
  at: number;
  /** In a line of text, rather than a block of its own. */
  inLine: boolean;
  /** Drawn just after its shown source. */
  isAfterSource?: boolean;
}

/** A rendered image as the editor's DOM holds it. */
function drawnImage(drawn: Drawn): HTMLImageElement {
  const found = (is: boolean) => (is ? {} : null);
  return {
    drawn,
    classList: { contains: () => false },
    parentElement: { classList: { contains: () => false } },
    getBoundingClientRect: () => ({ top: 0, width: 100 }),
    closest: (selector: string) => {
      if (selector === ".cm-line") {
        return found(drawn.inLine);
      }
      if (selector === ".md-image-after-source") {
        return found(drawn.isAfterSource ?? false);
      }
      return null;
    },
  } as unknown as HTMLImageElement;
}

function viewOf(doc: string, images: HTMLImageElement[]): EditorView {
  return {
    state: EditorState.create({ doc }),
    contentDOM: { querySelectorAll: () => images },
    posAtDOM: (image: { drawn: Drawn }) => image.drawn.at,
  } as unknown as EditorView;
}

test("an image alone on a line with trailing spaces is found where its block draws it, over the line or below it", () => {
  // The block runs to the line's end (12); the embed ends at 10.
  const doc = "![[a.png]]  \n\nafter";
  const embed = { from: 0, to: 10 };
  for (const at of [0, 12]) {
    const image = drawnImage({ at, inLine: false });
    assert.deepEqual(imagesOf(viewOf(doc, [image]), embed), [image], `${at}`);
    // A click on it selects that embed, its source shown or not.
    assert.deepEqual(embedOfImage(viewOf(doc, [image]), image), embed);
  }
});

test("a clicked image alone on a line with trailing spaces is scrolled back once its source shows", () => {
  const doc = "![[a.png]]  \n\nafter";
  const top = { value: 300 };
  const image = drawnImage({ at: 12, inLine: false });
  (
    image as unknown as { getBoundingClientRect: () => unknown }
  ).getBoundingClientRect = () => ({ top: top.value });
  const view = Object.assign(viewOf(doc, [image]), {
    scaleY: 1,
    scrollDOM: { scrollTop: 0 },
    requestMeasure(request: { read(): unknown; write(value: unknown): void }) {
      request.write(request.read());
    },
  });
  const pin = new ClickedImagePin(view, (range) => imagesOf(view, range));
  pin.press(image, { from: 0, to: 10 });
  top.value = 324;
  pin.update({
    state: view.state,
    changes: view.state.changes(),
  } as unknown as Parameters<ClickedImagePin["update"]>[0]);
  assert.equal(view.scrollDOM.scrollTop, 24);
});

test("of two abutting images, each finds only its own drawing, shown or not", () => {
  const doc = "aa ![[a.png]]![[b.png]] zz";
  const a = { from: 3, to: 13 };
  const b = { from: 13, to: 23 };
  // Drawn in place of their sources: at 3 and 13.
  const inPlace = [
    drawnImage({ at: 3, inLine: true }),
    drawnImage({ at: 13, inLine: true }),
  ];
  let view = viewOf(doc, inPlace);
  assert.deepEqual(imagesOf(view, a), [inPlace[0]]);
  assert.deepEqual(imagesOf(view, b), [inPlace[1]]);
  // Drawn after their shown sources: at 13 and 23.
  const after = [
    drawnImage({ at: 13, inLine: true, isAfterSource: true }),
    drawnImage({ at: 23, inLine: true, isAfterSource: true }),
  ];
  view = viewOf(doc, after);
  assert.deepEqual(imagesOf(view, a), [after[0]]);
  assert.deepEqual(imagesOf(view, b), [after[1]]);
});
