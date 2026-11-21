import {
  AxisLock,
  GESTURE_GAP_MS,
  type Axis,
} from "@workshop/scroll/axis-lock";
import {
  holdAcross,
  routeGesture,
  type OverflowOf,
  type ScrollRoute,
  type Scroller,
} from "./scroll-route";

/** What the rails need of the note: its scroller, and the size of a line. */
export interface RailsOptions {
  /** Where wheel events are heard: the editor's root element. */
  readonly dom: Pick<HTMLElement, "addEventListener">;
  /** The note's own scroller, where a gesture lands when nothing nearer scrolls. */
  readonly scroller: Scroller;
  readonly lineHeight: () => number;
  readonly overflowOf?: OverflowOf;
  /** The clock of `performance.now()`, in ms. */
  readonly now?: () => number;
  /** Runs `callback` before the next frame, once its scroll positions are current. */
  readonly beforeFrame?: (callback: () => void) => void;
}

/**
 * Locks a wheel or trackpad gesture that is nearly straight to its axis, over
 * the note and everything in it that scrolls (tables, code, diagrams).
 *
 * The browser scrolls a wheel gesture itself, on its compositor thread, and
 * waits for no page script unless one could cancel the wheel. Every wheel
 * listener on the scroll path is therefore passive (the quality check
 * "no wheel or touch listener makes scrolling wait for the page"), and so
 * is this one, until it has something to cancel. Only when a gesture is locked
 * and still carries movement across its axis does the listener become one
 * that can cancel, for the rest of that gesture: it is passive again a
 * gesture's pause after the last event. A swipe straight up and down, or a
 * mouse wheel (which has no sideways movement at all), never gets this far,
 * and a diagonal gesture leaves the browser to scroll it freely.
 *
 * While it can cancel, every event of the gesture is taken: the movement
 * along the axis is applied to the scroller the browser would have chosen
 * (the nearest one that can go that way), and the movement across it is
 * dropped. The few events before the lock, and the one or two after it that
 * the browser had already been handed, reached the browser whole; whatever
 * they moved across the axis is put back.
 */
export class WheelRails {
  private readonly lock = new AxisLock();
  private route: ScrollRoute | null = null;
  private routeGesture = -1;
  private listening: AbortController | null = null;
  private canCancel = false;
  private lastEvent = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly now: () => number;

  constructor(private readonly options: RailsOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  start(): void {
    if (this.listening === null) {
      this.listen(false);
    }
  }

  stop(): void {
    this.listening?.abort();
    this.listening = null;
    this.canCancel = false;
    this.route = null;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private listen(canCancel: boolean): void {
    this.listening?.abort();
    this.listening = new AbortController();
    this.canCancel = canCancel;
    this.options.dom.addEventListener("wheel", this.onWheel, {
      capture: true,
      passive: !canCancel,
      signal: this.listening.signal,
    });
  }

  private readonly onWheel = (event: WheelEvent): void => {
    const axis = this.lock.axisFor(event);
    if (axis === null) {
      // A pinch or a Shift wheel leaves the gesture be; a new gesture ends it.
      if (this.route !== null && this.routeGesture !== this.lock.gesture) {
        this.endLockedGesture();
      }
      return;
    }
    const across = axis === "y" ? event.deltaX : event.deltaY;
    if (across === 0 && !this.canCancel) {
      // Nothing to take: the browser scrolls it, a notch or a straight swipe.
      return;
    }
    this.lastEvent = this.now();
    this.route = this.routeOf(event, axis);
    this.timer ??= setTimeout(this.expire, GESTURE_GAP_MS);
    if (!this.canCancel) {
      this.listen(true);
    }
    if (event.cancelable) {
      event.preventDefault();
      this.scrollAlong(event, axis);
    } else {
      this.holdLater(axis);
    }
  };

  /** The route of the event's gesture, made when it locked. */
  private routeOf(event: WheelEvent, axis: Axis): ScrollRoute {
    const gesture = this.lock.gesture;
    if (this.route !== null && this.routeGesture === gesture) {
      return this.route;
    }
    this.routeGesture = gesture;
    const root = this.options.scroller;
    const along = axis === "y" ? event.deltaY : event.deltaX;
    return routeGesture({
      target: isScroller(event.target) ? event.target : root,
      root,
      axis,
      direction: Math.sign(along),
      ...(this.options.overflowOf && { overflowOf: this.options.overflowOf }),
    });
  }

  /** Move the route's scroller by the event's movement along the axis, as the browser would. */
  private scrollAlong(event: WheelEvent, axis: Axis): void {
    const delta = axis === "y" ? event.deltaY : event.deltaX;
    const px = this.pixels(delta, event.deltaMode, axis);
    this.route?.scroller.scrollBy(
      axis === "y"
        ? { top: px, behavior: "instant" }
        : { left: px, behavior: "instant" },
    );
  }

  private pixels(delta: number, mode: number, axis: Axis): number {
    if (mode === 1) {
      return delta * this.options.lineHeight();
    }
    if (mode !== 2) {
      return delta;
    }
    const scroller = this.route?.scroller ?? this.options.scroller;
    return (
      delta * (axis === "y" ? scroller.clientHeight : scroller.clientWidth)
    );
  }

  /**
   * An event the browser already had: it scrolled across the axis too, and
   * the page hears of it while that is being drawn, so wait for the frame.
   * Every such event gets its own frame: the browser applies its movement
   * when it likes, and one put back too early is moved again.
   */
  private holdLater(axis: Axis): void {
    const route = this.route;
    const beforeFrame =
      this.options.beforeFrame ?? ((run) => requestAnimationFrame(run));
    beforeFrame(() => {
      if (route !== null && route === this.route) {
        holdAcross(route, axis);
      }
    });
  }

  /** The pause that ends a gesture: stop being able to cancel. */
  private readonly expire = (): void => {
    this.timer = undefined;
    const idle = this.now() - this.lastEvent;
    if (idle < GESTURE_GAP_MS) {
      this.timer = setTimeout(this.expire, GESTURE_GAP_MS - idle);
      return;
    }
    this.endLockedGesture();
  };

  private endLockedGesture(): void {
    this.route = null;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.canCancel && this.listening !== null) {
      this.listen(false);
    }
  }
}

/** An element of the page, rather than the document, a window or a text node. */
function isScroller(
  target: EventTarget | null,
): target is Scroller & EventTarget {
  return (
    typeof target === "object" &&
    target !== null &&
    "parentElement" in target &&
    "scrollBy" in target
  );
}
