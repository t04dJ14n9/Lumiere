/**
 * When a click on a backlink overlay opens its note. The overlay sits over
 * the text, and a press on it also starts EmbedPDF's text selection (the
 * pointer events bubble to the page). The browser then sends a `click`
 * whenever the press and the release land on the same line box, so a
 * double-click on a word, or a drag within one highlighted line, would jump
 * to the note instead of selecting. Only a plain click may open it.
 */

/** A place on the screen, in CSS pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * How far the pointer may move between press and release and still be a
 * click. EmbedPDF starts a selection drag at 3 page points; a drag it counts
 * that this does not (zoomed out) leaves a selection, which stops the open too.
 */
export const CLICK_SLOP_PX = 4;

/**
 * How long a lone click waits for a second one. The first click of a
 * double-click is, on its own, an ordinary click; only waiting shows that it
 * is not.
 */
export const DOUBLE_CLICK_MS = 300;

export interface ClickGesture {
  /** Where the primary button went down on the overlay, if seen. */
  pressedAt: ScreenPoint | undefined;
  /** Where the click was reported. */
  clickedAt: ScreenPoint;
  /** `MouseEvent.detail`: 1 for a lone click, 2 or more in a double-click. */
  detail: number;
  /** Whether a text selection exists when the click arrives. */
  hasSelection: boolean;
}

/**
 * Whether this click may open the note: the first click of a sequence, with
 * the pointer where it went down, and nothing selected by the gesture (the
 * press clears any earlier selection, so one now is the gesture's own).
 */
export function isOpenClick(gesture: ClickGesture): boolean {
  if (gesture.detail !== 1 || gesture.hasSelection) {
    return false;
  }
  const { pressedAt, clickedAt } = gesture;
  if (!pressedAt) {
    return true;
  }
  return (
    Math.hypot(clickedAt.x - pressedAt.x, clickedAt.y - pressedAt.y) <=
    CLICK_SLOP_PX
  );
}

/** The timer functions a `DeferredOpen` needs (a browser's, or a test's). */
export interface Timers {
  set(run: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

/** An open that waits out the double-click interval and can be called off. */
export interface DeferredOpen {
  /** Open after the wait, unless cancelled; replaces a pending open. */
  schedule(open: () => void): void;
  /** Call off the pending open, if any (a second click came). */
  cancel(): void;
}

export function createDeferredOpen(
  timers: Timers,
  delayMs: number = DOUBLE_CLICK_MS,
): DeferredOpen {
  let handle: unknown;
  let isPending = false;
  const cancel = (): void => {
    if (isPending) {
      timers.clear(handle);
      isPending = false;
    }
  };
  return {
    cancel,
    schedule(open) {
      cancel();
      isPending = true;
      handle = timers.set(() => {
        isPending = false;
        open();
      }, delayMs);
    },
  };
}
