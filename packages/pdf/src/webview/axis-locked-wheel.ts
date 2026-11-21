import { AxisLock } from "@workshop/scroll/axis-lock";
import { currentViewSettings } from "./reading-position";

/**
 * The movement a trackpad or wheel gesture keeps when it is locked to the
 * axis it is nearly straight along (`editor.scrollPredominantAxis`, on by
 * default). One per hook, because it follows the gesture a hook's wheel
 * handler is hearing.
 */
export class LockedWheel {
  private readonly lock = new AxisLock();

  /**
   * The wheel's movement along its gesture's axis alone, in the wheel's own
   * units, or null when the viewer should pan it as it comes: the setting is
   * off, the gesture is diagonal or not yet judged, it is a pinch or a
   * Shift wheel, or the wheel has no movement across the axis to drop (a
   * mouse wheel's notches, a straight swipe).
   */
  along(event: WheelEvent): { dx: number; dy: number } | null {
    // The lock hears every wheel, the setting on or off, so it knows where a
    // gesture began when the setting changes in the middle of one.
    const axis = this.lock.axisFor(event);
    if (axis === null || currentViewSettings().predominantAxis === false) {
      return null;
    }
    const across = axis === "y" ? event.deltaX : event.deltaY;
    if (across === 0) {
      return null;
    }
    return axis === "y"
      ? { dx: 0, dy: event.deltaY }
      : { dx: event.deltaX, dy: 0 };
  }
}
