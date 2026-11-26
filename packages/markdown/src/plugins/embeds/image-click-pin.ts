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
 * by the source's height under the pointer, and a second click could land
 * on the source instead. The note
 * scrolls by that height instead, when it can. An image in a line of text
 * moves along its line and is left alone.
 *
 * The pin never overrides a scroll it did not make: it ends at the first
 * drawing of the image after the release, moved or not, and it corrects
 * nothing once the note has scrolled since the press, whatever scrolled it
 * (a wheel, touch, keys, the scrollbar, sticky scroll's header, CodeMirror
 * keeping its own anchor). Input events cannot say: a native scrollbar
 * drag fires no `pointerdown`, macOS overlay scrollbars only `scroll`, and
 * other plugins scroll the note with `scrollBy`.
 */
export class ClickedImagePin {
  private pin:
    | {
        range: Range;
        top: number;
        /** The note's scroll position at the press. */
        scrollTop: number;
        releasedAt: number | undefined;
      }
    | undefined;

  constructor(
    private readonly view: EditorView,
    private readonly imagesOf: (range: Range) => HTMLImageElement[],
    private readonly now: () => number = Date.now,
  ) {}

  /** Remembers where a pressed image is drawn, if it is a block. */
  press(image: HTMLImageElement, range: Range): void {
    this.pin = image.closest(".cm-line")
      ? undefined
      : {
          range,
          top: image.getBoundingClientRect().top,
          scrollTop: this.view.scrollDOM.scrollTop,
          releasedAt: undefined,
        };
  }

  /**
   * Once the press has ended, scrolls the image back to where it was when
   * its source shows. That may be a little after the release: the image
   * drawn below the source may come in a later frame, once it is rendered
   * (see `redrawn`). So the pin lasts a short while after the release, and
   * ends with the image's first drawing after it, when the note has
   * scrolled, or when the reader moves on.
   */
  update(update: ViewUpdate): void {
    const pin = this.pin;
    if (!pin) {
      return;
    }
    // An edit while the button is down (another panel's, a sync) moves it.
    pin.range = {
      from: update.changes.mapPos(pin.range.from, 1),
      to: update.changes.mapPos(pin.range.to, -1),
    };
    if (isPointerSelecting(update.state)) {
      return;
    }
    const isReleased = pin.releasedAt !== undefined;
    pin.releasedAt ??= this.now();
    if (isReleased && (update.docChanged || !isAtImage(update, pin.range))) {
      this.pin = undefined;
      return;
    }
    this.redrawn();
  }

  /** The editor's content was drawn again: the image may have moved. */
  redrawn(): void {
    const pin = this.pin;
    if (!pin || pin.releasedAt === undefined) {
      return;
    }
    if (this.now() - pin.releasedAt > PIN_AFTER_RELEASE_MS) {
      this.pin = undefined;
      return;
    }
    const { view } = this;
    view.requestMeasure({
      key: this,
      read: () => ({
        top: this.imagesOf(pin.range)[0]?.getBoundingClientRect().top,
        hasScrolled: Math.abs(view.scrollDOM.scrollTop - pin.scrollTop) >= 1,
      }),
      write: ({ top, hasScrolled }) => {
        if (this.pin !== pin) {
          return;
        }
        // Scrolled by anyone but the pin: the image is where they put it.
        if (hasScrolled) {
          this.pin = undefined;
          return;
        }
        // Not drawn yet: its drawing below the source may come later.
        if (top === undefined) {
          return;
        }
        // Drawn: whether it moved or not, this is the release's doing, the
        // only move to undo; later ones are the reader's.
        this.pin = undefined;
        if (Math.abs(top - pin.top) >= 1) {
          view.scrollDOM.scrollTop += (top - pin.top) / view.scaleY;
        }
      },
    });
  }
}

/** How long after the release a clicked image's move is undone. */
const PIN_AFTER_RELEASE_MS = 400;

/** Whether every selection range still touches the image (the reader has not moved on). */
function isAtImage(update: ViewUpdate, range: Range): boolean {
  return update.state.selection.ranges.every(
    (selection) => selection.from <= range.to && selection.to >= range.from,
  );
}
