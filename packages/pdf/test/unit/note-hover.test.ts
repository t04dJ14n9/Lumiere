import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoteHover,
  NOTE_CLOSE_DELAY_MS,
  NOTE_OPEN_DELAY_MS,
} from "../../src/shared/note-hover";

/** A hover with a fake clock: `tick(ms)` runs what was due by then. */
function setUp() {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const shown: (string | undefined)[] = [];
  const hover = createNoteHover({
    schedule: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return {
        cancel: () => {
          timer.live = false;
        },
      };
    },
    onChange: (key) => shown.push(key),
  });
  const tick = (ms: number) => {
    now += ms;
    for (const timer of timers.filter((t) => t.live && t.at <= now)) {
      timer.live = false;
      timer.run();
    }
  };
  return { hover, shown, tick };
}

test("a note shows once the pointer rests on its mark", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS - 1);
  assert.deepEqual(shown, [], "passing over a mark shows nothing");
  tick(1);
  assert.deepEqual(shown, ["a"]);
  assert.equal(hover.shown(), "a");
});

test("moving on before the delay shows nothing", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS / 2);
  hover.pointerOver(undefined);
  tick(NOTE_OPEN_DELAY_MS * 2);
  assert.deepEqual(shown, []);
});

test("moving within the same mark keeps its timer", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS / 2);
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS / 2);
  assert.deepEqual(shown, ["a"]);
});

test("the card stays while the pointer crosses into it, and closes after it leaves", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS);
  hover.pointerOver(undefined);
  tick(NOTE_CLOSE_DELAY_MS / 2);
  hover.cardEntered();
  tick(NOTE_CLOSE_DELAY_MS * 4);
  assert.deepEqual(shown, ["a"], "reading the card keeps it");
  hover.cardLeft();
  tick(NOTE_CLOSE_DELAY_MS - 1);
  assert.deepEqual(shown, ["a"]);
  tick(1);
  assert.deepEqual(shown, ["a", undefined]);
});

test("returning to the mark before the card closes keeps it", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS);
  hover.pointerOver(undefined);
  tick(NOTE_CLOSE_DELAY_MS / 2);
  hover.pointerOver("a");
  tick(NOTE_CLOSE_DELAY_MS * 4);
  assert.deepEqual(shown, ["a"]);
});

test("resting on another mark shows its note instead", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS);
  hover.pointerOver("b");
  tick(NOTE_OPEN_DELAY_MS);
  assert.deepEqual(shown, ["a", "b"]);
});

test("dismiss closes at once and forgets what was pending", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  tick(NOTE_OPEN_DELAY_MS);
  hover.pointerOver("b");
  hover.dismiss();
  tick(NOTE_OPEN_DELAY_MS * 2);
  assert.deepEqual(shown, ["a", undefined]);
  hover.dismiss();
  assert.deepEqual(shown, ["a", undefined], "nothing shown, nothing to close");
});

test("dispose stops every timer", () => {
  const { hover, shown, tick } = setUp();
  hover.pointerOver("a");
  hover.dispose();
  tick(NOTE_OPEN_DELAY_MS * 2);
  assert.deepEqual(shown, []);
});
