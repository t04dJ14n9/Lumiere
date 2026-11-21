/** The axis a scroll gesture is locked to: sideways (`x`) or up and down (`y`). */
export type Axis = "x" | "y";

/** What the lock reads of a `WheelEvent`; the DOM type satisfies it. */
export interface WheelSample {
  readonly deltaX: number;
  readonly deltaY: number;
  /** DOM delta modes: pixel 0, line 1, page 2. */
  readonly deltaMode: number;
  /** When the event happened, in ms on a clock that only goes forward. */
  readonly timeStamp: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * A gesture locks to an axis when its sideways travel (or its vertical
 * travel) is at most this fraction of the other's: 0.5 is 26.6 degrees from
 * the axis. A trackpad swipe that means "down" strays 10 to 20 degrees;
 * someone who means "diagonally" is past 35.
 */
export const RAIL_RATIO = 0.5;

/**
 * A pause this long (ms) between wheel events ends a gesture. A trackpad
 * sends an event every frame, and its momentum (the coasting after the
 * fingers lift) does too, so a pause is a new gesture. It matches the
 * pause Lumiere PDF uses to tell a notch of a mouse wheel from a swipe.
 */
export const GESTURE_GAP_MS = 150;

/** How far (px) a gesture travels, or how many events it takes, before its angle is judged. */
const DECIDE_DISTANCE_PX = 8;
const DECIDE_EVENTS = 3;

/**
 * Momentum cannot be told from a new swipe by a pause when the fingers land
 * again before it stops. Movement across the locked axis, beyond what
 * movement along it cancels, ends the lock once it adds up to this (px): a
 * swipe the other way round, not drift.
 */
const BREAKOUT_PX = 48;

/** The pixels of a line and of a page, for judging an angle; applying a delta is the caller's. */
const LINE_PX = 40;
const PAGE_PX = 800;

function pixels(delta: number, mode: number): number {
  if (mode === 1) {
    return delta * LINE_PX;
  }
  return mode === 2 ? delta * PAGE_PX : delta;
}

/**
 * Locks a wheel or trackpad gesture to the axis it is nearly straight along,
 * as VS Code's `editor.scrollPredominantAxis` and AppKit's
 * `usesPredominantAxisScrolling` do, but deciding once for the whole gesture
 * (momentum included) from its first events rather than event by event.
 *
 * A gesture is the wheel events with no pause of {@link GESTURE_GAP_MS}
 * between them. Its first few events add up to a direction. If the shorter
 * axis is at most {@link RAIL_RATIO} of the longer, the gesture locks to the
 * longer; otherwise it is diagonal and scrolls freely. Until it is judged
 * the caller scrolls as usual: the judging takes a few pixels.
 *
 * Pinches and zooms (Ctrl or Cmd held) and Shift's sideways wheel are not
 * scrolling gestures here and pass untouched, without disturbing the
 * gesture in progress.
 */
export class AxisLock {
  /** Counts gestures, so a caller can tell when a new one began. */
  gesture = 0;
  private lastTime = -Infinity;
  private x = 0;
  private y = 0;
  private events = 0;
  private decided = false;
  private axis: Axis | null = null;
  private crossing = 0;

  /**
   * The axis this event's gesture is locked to, or null when it scrolls
   * freely or has not been judged yet. Call it for every wheel event.
   */
  axisFor(event: WheelSample): Axis | null {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return null;
    }
    const dx = pixels(event.deltaX, event.deltaMode);
    const dy = pixels(event.deltaY, event.deltaMode);
    if (
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      (dx === 0 && dy === 0)
    ) {
      return null;
    }
    if (
      event.timeStamp - this.lastTime >= GESTURE_GAP_MS ||
      this.crosses(dx, dy)
    ) {
      this.begin();
    }
    this.lastTime = event.timeStamp;
    if (!this.decided) {
      this.judge(dx, dy);
    }
    return this.axis;
  }

  private begin(): void {
    this.gesture++;
    this.x = 0;
    this.y = 0;
    this.events = 0;
    this.decided = false;
    this.axis = null;
    this.crossing = 0;
  }

  /** Whether a locked gesture's movement across its axis has become a new swipe. */
  private crosses(dx: number, dy: number): boolean {
    if (this.axis === null) {
      return false;
    }
    const along = this.axis === "y" ? Math.abs(dy) : Math.abs(dx);
    const across = this.axis === "y" ? Math.abs(dx) : Math.abs(dy);
    this.crossing = Math.max(0, this.crossing + across - along);
    return this.crossing >= BREAKOUT_PX;
  }

  private judge(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.events++;
    const x = Math.abs(this.x);
    const y = Math.abs(this.y);
    if (x + y < DECIDE_DISTANCE_PX && this.events < DECIDE_EVENTS) {
      return;
    }
    this.decided = true;
    const [along, across] = x >= y ? [x, y] : [y, x];
    if (across <= RAIL_RATIO * along) {
      this.axis = x >= y ? "x" : "y";
    }
  }
}
