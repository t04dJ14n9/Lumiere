import assert from "node:assert/strict";
import { test } from "node:test";
import { Throttle, type ThrottleClock } from "../../src/shared/throttle";

/** A clock the test moves, and the calls it has been asked to make later. */
function clock() {
  let now = 0;
  const waiting = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  const fake: ThrottleClock = {
    now: () => now,
    after: (ms, run) => {
      waiting.set(++next, { at: now + ms, run });
      return next;
    },
    cancel: (handle) => void waiting.delete(handle as number),
  };
  return {
    fake,
    waiting,
    advance(ms: number) {
      now += ms;
      for (const [id, call] of [...waiting]) {
        if (call.at <= now) {
          waiting.delete(id);
          call.run();
        }
      }
    },
  };
}

test("the first call after a quiet spell runs at once, the rest of a burst once when the interval is over", () => {
  const time = clock();
  let runs = 0;
  const throttle = new Throttle(() => runs++, 100, time.fake);
  throttle.call();
  assert.equal(runs, 1);
  for (let call = 0; call < 20; call++) {
    time.advance(4);
    throttle.call();
  }
  assert.equal(runs, 1, "within the interval nothing more runs");
  time.advance(20);
  assert.equal(runs, 2, "the interval ends with one run for the burst");
  time.advance(500);
  assert.equal(runs, 2, "and nothing is left over");
  throttle.call();
  assert.equal(runs, 3, "a call after the quiet is at once again");
});

test("a burst that never stops runs once per interval", () => {
  const time = clock();
  let runs = 0;
  const throttle = new Throttle(() => runs++, 100, time.fake);
  for (let call = 0; call < 125; call++) {
    throttle.call();
    time.advance(8);
  }
  assert.ok(runs >= 9 && runs <= 11, `${runs} runs in a second of calls`);
});

test("flush runs a call that waits for the interval, and only that", () => {
  const time = clock();
  let runs = 0;
  const throttle = new Throttle(() => runs++, 100, time.fake);
  throttle.flush();
  assert.equal(runs, 0, "nothing waits: nothing runs");
  throttle.call();
  throttle.call();
  assert.equal(runs, 1);
  throttle.flush();
  assert.equal(runs, 2);
  assert.equal(time.waiting.size, 0, "the timer is let go");
  time.advance(500);
  assert.equal(runs, 2);
});
