import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  OUTLINE_JUMP_MS,
  OutlineJumpWindow,
} from "../../../src/plugins/outline/jump-window";

/** A window with the clock under test control; `released` lists what it let go. */
function windowUnder(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const released: number[] = [];
  const window = new OutlineJumpWindow<number>((report) =>
    released.push(report),
  );
  t.after(() => window.dispose());
  return { window, released, tick: (ms: number) => t.mock.timers.tick(ms) };
}

test("nothing is held without a click", (t) => {
  const { window, released, tick } = windowUnder(t);
  assert.equal(window.holdReading(1), false);
  assert.equal(window.isCaretOnJump("0"), false);
  window.start(undefined);
  assert.equal(window.holdReading(2), false);
  assert.equal(window.isCaretOnJump("0"), false);
  tick(OUTLINE_JUMP_MS * 2);
  assert.deepEqual(released, []);
});

test("scroll follow is held for the whole window, then released", (t) => {
  const { window, tick } = windowUnder(t);
  window.start("1");
  assert.equal(window.holdReading(1), true);
  tick(OUTLINE_JUMP_MS);
  assert.equal(window.holdReading(2), true, "held up to the last moment");
  tick(1);
  assert.equal(window.holdReading(3), false);
  assert.equal(window.isCaretOnJump("1"), false, "the window is over");
});

test("the last report held is released when the window closes", (t) => {
  const { window, released, tick } = windowUnder(t);
  window.start("1");
  window.holdReading(1);
  tick(300);
  window.holdReading(2);
  tick(300);
  window.holdReading(3);
  tick(OUTLINE_JUMP_MS - 600);
  assert.deepEqual(released, [], "nothing while the window is open");
  tick(1);
  assert.deepEqual(released, [3], "only the newest, once");
  tick(OUTLINE_JUMP_MS);
  assert.deepEqual(released, [3]);
  assert.equal(window.holdReading(4), false, "the window is closed");
});

test("a window with nothing held releases nothing", (t) => {
  const { window, released, tick } = windowUnder(t);
  window.start("1");
  tick(OUTLINE_JUMP_MS * 2);
  assert.deepEqual(released, []);
});

test("a report just after the window, before its timer fires, is followed, not held", (t) => {
  // Only the clock is under test: the release timer is a real one that has
  // not fired yet, as when the event loop is busy at the window's end.
  t.mock.timers.enable({ apis: ["Date"] });
  const released: number[] = [];
  const window = new OutlineJumpWindow<number>((report) =>
    released.push(report),
  );
  t.after(() => window.dispose());
  window.start("1");
  window.holdReading(1);
  t.mock.timers.tick(OUTLINE_JUMP_MS + 1);
  assert.equal(window.holdReading(2), false);
  assert.deepEqual(released, [], "the older report is dropped, not released");
});

test("dropping what is held keeps it from being released", (t) => {
  const { window, released, tick } = windowUnder(t);
  window.start("1");
  window.holdReading(1);
  window.dropHeld();
  tick(OUTLINE_JUMP_MS + 1);
  assert.deepEqual(released, []);
});

test("a second click drops what the first held", (t) => {
  const { window, released, tick } = windowUnder(t);
  window.start("1");
  window.holdReading(1);
  tick(500);
  window.start("2");
  tick(OUTLINE_JUMP_MS - 1);
  assert.deepEqual(released, [], "the second window is still open");
  window.holdReading(2);
  tick(2);
  assert.deepEqual(released, [2]);
});

test("a stopped window releases nothing", (t) => {
  const { window, released, tick } = windowUnder(t);
  window.start("1");
  window.holdReading(1);
  window.dispose();
  tick(OUTLINE_JUMP_MS * 2);
  assert.deepEqual(released, []);
  assert.equal(window.holdReading(2), false);
});

test("the caret from before the click and at the heading belongs to the jump", (t) => {
  const { window } = windowUnder(t);
  window.start("1");
  assert.equal(window.isCaretOnJump("0"), true, "reported before it landed");
  assert.equal(window.isCaretOnJump("1"), true, "landed on the heading");
  assert.equal(window.isCaretOnJump("1"), true, "still there");
});

test("a caret that moves on after landing ends the jump", (t) => {
  const { window } = windowUnder(t);
  window.start("1");
  assert.equal(window.isCaretOnJump("1"), true);
  assert.equal(window.isCaretOnJump("2"), false);
  assert.equal(window.holdReading(1), false, "scroll follow resumes too");
  assert.equal(window.isCaretOnJump("0"), false);
});

test("a caret after the window is not the jump's", (t) => {
  const { window, tick } = windowUnder(t);
  window.start("1");
  tick(OUTLINE_JUMP_MS + 1);
  assert.equal(window.isCaretOnJump("0"), false);
  assert.equal(window.isCaretOnJump("1"), false);
});
