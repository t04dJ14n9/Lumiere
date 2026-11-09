export interface WheelDelta {
  deltaX: number;
  deltaY: number;
  /** DOM delta modes: pixel = 0, line = 1, page = 2. */
  deltaMode: number;
}

/** Only identifiable discrete notches; small/fractional/diagonal pixel deltas are left to the Stage. */
export function isDiscreteWheel({
  deltaX,
  deltaY,
  deltaMode,
}: WheelDelta): boolean {
  if (!Number.isFinite(deltaY) || deltaY === 0 || deltaX !== 0) {
    return false;
  }
  if (deltaMode === 1 || deltaMode === 2) {
    return true;
  }
  const amount = Math.abs(deltaY);
  return (
    deltaMode === 0 &&
    Number.isInteger(amount) &&
    amount >= 100 &&
    (amount % 100 === 0 || amount % 120 === 0)
  );
}

/** A wheel delta in pixels: lines count as 40 pixels, pages as `pageSize`. */
export function wheelPixels(
  delta: number,
  mode: number,
  pageSize: number,
): number {
  if (mode === 1) {
    return delta * 40;
  }
  return mode === 2 ? delta * pageSize : delta;
}

/** Adds wheel steps, but reversals start at the displayed position immediately. */
export function wheelTarget(
  position: number,
  target: number,
  delta: number,
  limit: { min: number; max: number },
): number {
  const remaining = target - position;
  const from =
    remaining !== 0 && Math.sign(remaining) !== Math.sign(delta)
      ? position
      : target;
  return Math.min(limit.max, Math.max(limit.min, from + delta));
}

/** A pause this long (ms) between wheel events ends a gesture. */
export const WHEEL_GESTURE_GAP = 150;

/**
 * Tells mouse-wheel notches from trackpad gestures. A trackpad flick can
 * include a delta that looks like a notch (an integral 100 or 200), so the
 * whole gesture is judged: once any event of it is not a notch (small,
 * fractional, diagonal), the rest of it, momentum included, is left to the Stage.
 */
export class WheelGesture {
  private last = -Infinity;
  private trackpad = false;

  /** Whether this event is a discrete notch, to be animated rather than left to the Stage. */
  discrete(event: WheelDelta, time: number): boolean {
    if (time - this.last > WHEEL_GESTURE_GAP) {
      this.trackpad = false;
    }
    this.last = time;
    if (!isDiscreteWheel(event)) {
      this.trackpad = true;
    }
    return !this.trackpad;
  }
}
