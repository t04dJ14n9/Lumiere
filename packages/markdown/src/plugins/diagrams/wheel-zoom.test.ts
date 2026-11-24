import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENT_PIXELS,
  ZOOM_PER_PIXEL,
  wheelZoomFactor,
} from "./wheel-zoom";

const pixels = (deltaY: number) => wheelZoomFactor({ deltaY, deltaMode: 0 });
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

test("a trackpad pinch zooms in proportion to how far the fingers move, not a step per event", () => {
  // A pinch sends many small ctrlKey wheel events.
  close(pixels(-2), Math.exp(2 * ZOOM_PER_PIXEL));
  close(pixels(3), Math.exp(-3 * ZOOM_PER_PIXEL));
  assert.ok(pixels(-1) > 1 && pixels(-1) < 1.02);
  // Ten 1-pixel events zoom as much as one 10-pixel event.
  close(pixels(-1) ** 10, pixels(-10));
  assert.equal(pixels(0), 1);
});

test("a mouse wheel notch keeps the 15 % step, in pixels, lines or pages", () => {
  assert.equal(MAX_EVENT_PIXELS * ZOOM_PER_PIXEL, 0.15);
  close(pixels(-100), Math.exp(0.15));
  close(pixels(100), Math.exp(-0.15));
  close(wheelZoomFactor({ deltaY: 3, deltaMode: 1 }), Math.exp(-0.15));
  close(wheelZoomFactor({ deltaY: -1, deltaMode: 2 }), Math.exp(0.15));
});
