import assert from "node:assert/strict";
import { test } from "node:test";
import { WheelGesture } from "../../src/shared/smooth-motion";

const pixel = (deltaY: number, deltaX = 0) => ({
  deltaX,
  deltaY,
  deltaMode: 0,
});

test("a mouse wheel's notches are discrete; a trackpad flick is native even when one delta looks like a notch", () => {
  const wheel = new WheelGesture();
  assert.equal(wheel.discrete(pixel(100), 0), true);
  assert.equal(wheel.discrete(pixel(120), 40), true);
  assert.equal(
    wheel.discrete({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 80),
    true,
  );
  const flick = new WheelGesture();
  for (const [index, delta] of [
    2, 9, 30, 100, 200, 300, 140, 60, 12, 1,
  ].entries()) {
    assert.equal(
      flick.discrete(pixel(delta), 1_000 + index * 16),
      false,
      String(delta),
    );
  }
  // After a pause, the next gesture is judged anew.
  assert.equal(flick.discrete(pixel(100), 2_000), true);
  // A diagonal or fractional delta marks a trackpad.
  assert.equal(new WheelGesture().discrete(pixel(100, 4), 0), false);
  assert.equal(new WheelGesture().discrete(pixel(100.5), 0), false);
});
