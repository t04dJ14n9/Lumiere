import type { EditorView, ViewUpdate } from "@codemirror/view";
import { isPointerSelecting } from "../../webview/ui/pointer-selection";

interface Range {
  from: number;
  to: number;
}

/**
 * Keeps a clicked image alone on its line where it was on screen. A click
 * selects the image and puts the caret at its start, so its source shows
 * above it once the button is released (the reveal waits for the release,
 * like every reveal under a press). Without this the image would move down
 * by the source's height under the pointer, and the second click of a
 * double-click (the inspector) could land on the source instead. The note
 * scrolls by that height instead, when it can. An image in a line of text
 * moves along its line and is left alone.
 */
export class ClickedImagePin {
  private pin: { range: Range; top: number } | undefined;

  constructor(
    private readonly view: EditorView,
    private readonly imagesOf: (range: Range) => HTMLImageElement[],
  ) {}

  /** Remembers where a pressed image is drawn, if it is a block. */
  press(image: HTMLImageElement, range: Range): void {
    this.pin = image.closest(".cm-line")
      ? undefined
      : { range, top: image.getBoundingClientRect().top };
  }

  /** Once the press has ended, scrolls the image back to where it was. */
  update(update: ViewUpdate): void {
    const pin = this.pin;
    if (!pin || isPointerSelecting(update.state)) {
      return;
    }
    this.pin = undefined;
    const range = {
      from: update.changes.mapPos(pin.range.from, 1),
      to: update.changes.mapPos(pin.range.to, -1),
    };
    const { view } = this;
    view.requestMeasure({
      read: () => this.imagesOf(range)[0]?.getBoundingClientRect().top,
      write: (top) => {
        if (top !== undefined && Math.abs(top - pin.top) >= 1) {
          view.scrollDOM.scrollTop += (top - pin.top) / view.scaleY;
        }
      },
    });
  }
}
