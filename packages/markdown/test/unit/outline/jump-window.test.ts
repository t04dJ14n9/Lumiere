import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTLINE_JUMP_MS,
  OutlineJumpWindow,
} from "../../../src/plugins/outline/jump-window";

test("nothing is held without a click", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const window = new OutlineJumpWindow();
  assert.equal(window.isHoldingReading(), false);
  assert.equal(window.isCaretOnJump("0"), false);
  window.start(undefined);
  assert.equal(window.isHoldingReading(), false);
  assert.equal(window.isCaretOnJump("0"), false);
});

test("scroll follow is held for the whole window, then released", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const window = new OutlineJumpWindow();
  window.start("1");
  assert.equal(window.isHoldingReading(), true);
  t.mock.timers.tick(OUTLINE_JUMP_MS);
  assert.equal(window.isHoldingReading(), true, "held up to the last moment");
  t.mock.timers.tick(1);
  assert.equal(window.isHoldingReading(), false);
  assert.equal(window.isCaretOnJump("1"), false, "the window is over");
});

test("the caret from before the click and at the heading belongs to the jump", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const window = new OutlineJumpWindow();
  window.start("1");
  assert.equal(window.isCaretOnJump("0"), true, "reported before it landed");
  assert.equal(window.isCaretOnJump("1"), true, "landed on the heading");
  assert.equal(window.isCaretOnJump("1"), true, "still there");
});

test("a caret that moves on after landing ends the jump", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const window = new OutlineJumpWindow();
  window.start("1");
  assert.equal(window.isCaretOnJump("1"), true);
  assert.equal(window.isCaretOnJump("2"), false);
  assert.equal(window.isHoldingReading(), false, "scroll follow resumes too");
  assert.equal(window.isCaretOnJump("0"), false);
});

test("a caret after the window is not the jump's", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const window = new OutlineJumpWindow();
  window.start("1");
  t.mock.timers.tick(OUTLINE_JUMP_MS + 1);
  assert.equal(window.isCaretOnJump("0"), false);
  assert.equal(window.isCaretOnJump("1"), false);
});

test("a second click starts a fresh window", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const window = new OutlineJumpWindow();
  window.start("1");
  assert.equal(window.isCaretOnJump("1"), true);
  t.mock.timers.tick(OUTLINE_JUMP_MS - 100);
  window.start("2");
  t.mock.timers.tick(200);
  assert.equal(window.isHoldingReading(), true);
  assert.equal(window.isCaretOnJump("1"), true, "not landed on 2 yet");
});
