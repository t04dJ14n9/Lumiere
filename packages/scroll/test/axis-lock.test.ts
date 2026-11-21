import assert from "node:assert/strict";
import test from "node:test";
import {
  AxisLock,
  GESTURE_GAP_MS,
  RAIL_RATIO,
  type WheelSample,
} from "../src/axis-lock";

function wheel(
  deltaX: number,
  deltaY: number,
  timeStamp: number,
  extra: Partial<WheelSample> = {},
): WheelSample {
  return {
    deltaX,
    deltaY,
    deltaMode: 0,
    timeStamp,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  };
}

test("a gesture within the rail angle of an axis locks to it", () => {
  assert.equal(new AxisLock().axisFor(wheel(3, 40, 0)), "y");
  assert.equal(new AxisLock().axisFor(wheel(-3, -40, 0)), "y");
  assert.equal(new AxisLock().axisFor(wheel(40, 3, 0)), "x");
  assert.equal(new AxisLock().axisFor(wheel(-40, -3, 0)), "x");
  assert.equal(new AxisLock().axisFor(wheel(0, 120, 0)), "y");
  assert.equal(new AxisLock().axisFor(wheel(120, 0, 0)), "x");
});

test("the rail angle is the ratio's: just inside locks, just outside scrolls freely", () => {
  assert.equal(RAIL_RATIO, 0.5);
  // Exactly tan(26.57 degrees) of the longer axis is still a rail.
  assert.equal(new AxisLock().axisFor(wheel(10, 20, 0)), "y");
  assert.equal(new AxisLock().axisFor(wheel(20, 10, 0)), "x");
  // A hair beyond it, and a true diagonal, are free.
  assert.equal(new AxisLock().axisFor(wheel(10.5, 20, 0)), null);
  assert.equal(new AxisLock().axisFor(wheel(20, 10.5, 0)), null);
  assert.equal(new AxisLock().axisFor(wheel(20, 20, 0)), null);
});

test("a free gesture stays free to its end, momentum included", () => {
  const lock = new AxisLock();
  assert.equal(lock.axisFor(wheel(20, 20, 0)), null);
  // Momentum that happens to run straight does not lock it afterwards.
  for (let time = 16; time < 500; time += 16) {
    assert.equal(lock.axisFor(wheel(0, 10, time)), null);
  }
});

test("a locked gesture holds its axis for every later event, whatever its angle", () => {
  const lock = new AxisLock();
  assert.equal(lock.axisFor(wheel(4, 30, 0)), "y");
  assert.equal(lock.axisFor(wheel(14, 30, 16)), "y");
  assert.equal(lock.axisFor(wheel(2, 25, 32)), "y");
  assert.equal(lock.gesture, 1);
});

test("momentum keeps the lock for as long as events keep coming", () => {
  const lock = new AxisLock();
  assert.equal(lock.axisFor(wheel(2, 40, 0)), "y");
  for (let time = 16, delta = 40; time < 1600; time += 16) {
    delta *= 0.97;
    assert.equal(lock.axisFor(wheel(1, delta, time)), "y");
  }
  assert.equal(lock.gesture, 1);
});

test("a pause of the gesture gap starts a new gesture; one just short of it does not", () => {
  const lock = new AxisLock();
  assert.equal(lock.axisFor(wheel(2, 40, 1000)), "y");
  // Just short of the gap: the same gesture, still locked though now diagonal.
  assert.equal(lock.axisFor(wheel(30, 30, 1000 + GESTURE_GAP_MS - 1)), "y");
  assert.equal(lock.gesture, 1);
  // The gap itself: a new gesture, judged afresh, and diagonal.
  const later = 1000 + GESTURE_GAP_MS - 1 + GESTURE_GAP_MS;
  assert.equal(lock.axisFor(wheel(30, 30, later)), null);
  assert.equal(lock.gesture, 2);
  // And the next pause can lock it to the other axis.
  assert.equal(lock.axisFor(wheel(40, 2, later + GESTURE_GAP_MS)), "x");
  assert.equal(lock.gesture, 3);
});

test("a gesture's first events add up before it is judged", () => {
  const lock = new AxisLock();
  // Too small to judge: the caller scrolls as usual.
  assert.equal(lock.axisFor(wheel(1, 2, 0)), null);
  assert.equal(lock.axisFor(wheel(1, 2, 16)), null);
  // The third event, or enough distance, judges the whole: (3, 6) is straight.
  assert.equal(lock.axisFor(wheel(1, 2, 32)), "y");
  assert.equal(lock.axisFor(wheel(20, 2, 48)), "y");
});

test("jitter across the gesture's first events cancels out in the judgement", () => {
  const lock = new AxisLock();
  assert.equal(lock.axisFor(wheel(3, 4, 0)), null);
  assert.equal(lock.axisFor(wheel(-3, 4, 16)), "y");
});

test("a few events that are already far enough are judged at once", () => {
  assert.equal(new AxisLock().axisFor(wheel(1, 7, 0)), "y");
  assert.equal(new AxisLock().axisFor(wheel(5, 5, 0)), null);
});

test("pinch, zoom and Shift wheels pass untouched and leave the gesture alone", () => {
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey"] as const) {
    const lock = new AxisLock();
    assert.equal(lock.axisFor(wheel(2, 40, 0)), "y");
    assert.equal(lock.axisFor(wheel(2, 40, 16, { [modifier]: true })), null);
    // Two seconds on, the modified event neither ended nor extended the gesture.
    assert.equal(lock.axisFor(wheel(2, 40, 2000, { [modifier]: true })), null);
    assert.equal(lock.axisFor(wheel(2, 40, 32)), "y");
    assert.equal(lock.gesture, 1);
    // And on their own they never start one.
    assert.equal(
      new AxisLock().axisFor(wheel(0, 40, 0, { [modifier]: true })),
      null,
    );
    const fresh = new AxisLock();
    fresh.axisFor(wheel(0, 40, 0, { [modifier]: true }));
    assert.equal(fresh.gesture, 0);
  }
});

test("line and page deltas are judged by their pixels, and are straight when they are", () => {
  // A third of a line (13 px) across and one line (40 px) down: a rail.
  assert.equal(new AxisLock().axisFor(wheel(0.3, 1, 0, { deltaMode: 1 })), "y");
  // Half a line across, one down: past the rail.
  assert.equal(
    new AxisLock().axisFor(wheel(0.6, 1, 0, { deltaMode: 1 })),
    null,
  );
  // Fractions of a line are enough distance to judge at once.
  assert.equal(
    new AxisLock().axisFor(wheel(0.05, 0.3, 0, { deltaMode: 1 })),
    "y",
  );
  assert.equal(new AxisLock().axisFor(wheel(0.4, 0, 0, { deltaMode: 2 })), "x");
  assert.equal(
    new AxisLock().axisFor(wheel(0.4, 0.4, 0, { deltaMode: 2 })),
    null,
  );
});

test("a swipe across a locked gesture's axis, not drift, starts a new gesture", () => {
  const lock = new AxisLock();
  assert.equal(lock.axisFor(wheel(2, 40, 0)), "y");
  // Drift of a few pixels per event, canceled by movement along the axis.
  for (let index = 1; index <= 30; index++) {
    assert.equal(lock.axisFor(wheel(12, 40, index * 16)), "y");
  }
  assert.equal(lock.gesture, 1);
  // Fingers land again before the momentum is done and swipe sideways.
  const start = 31 * 16;
  assert.equal(lock.axisFor(wheel(30, 2, start)), "y");
  assert.equal(lock.axisFor(wheel(30, 2, start + 16)), "x");
  assert.equal(lock.gesture, 2);
  assert.equal(lock.axisFor(wheel(30, 2, start + 32)), "x");
});

test("empty and non-finite events are not gestures", () => {
  const lock = new AxisLock();
  assert.equal(lock.axisFor(wheel(0, 0, 0)), null);
  assert.equal(lock.axisFor(wheel(Number.NaN, 5, 0)), null);
  assert.equal(lock.axisFor(wheel(0, Number.POSITIVE_INFINITY, 0)), null);
  assert.equal(lock.gesture, 0);
});
