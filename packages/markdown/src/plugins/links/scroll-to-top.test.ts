import assert from "node:assert/strict";
import test from "node:test";
import type { EditorView } from "@codemirror/view";
import {
  correctScrollForStickyGrowth,
  scheduleStickyScrollCorrection,
  scrollTargetToTop,
  stickyChromeHeight,
} from "./scroll-to-top";

test("stickyChromeHeight is 0 when .mw-sticky-scroll is absent", () => {
  const root = {
    querySelector: () => null,
  } as unknown as ParentNode;
  assert.equal(stickyChromeHeight(root), 0);
});

test("correctScrollForStickyGrowth re-scrolls when sticky height changed", () => {
  const capture = (): {
    values: number[];
    rescroll: (y: number) => void;
  } => {
    const values: number[] = [];
    return { values, rescroll: (y) => values.push(y) };
  };

  let run = capture();
  correctScrollForStickyGrowth(0, () => 36, run.rescroll);
  assert.deepEqual(run.values, [36]);

  run = capture();
  correctScrollForStickyGrowth(36, () => 36, run.rescroll);
  assert.deepEqual(run.values, []);

  run = capture();
  correctScrollForStickyGrowth(36, () => 24, run.rescroll);
  assert.deepEqual(run.values, [24]);

  run = capture();
  correctScrollForStickyGrowth(0, () => 0, run.rescroll);
  assert.deepEqual(run.values, []);

  run = capture();
  correctScrollForStickyGrowth(20, () => 48, run.rescroll);
  assert.deepEqual(run.values, [48]);

  run = capture();
  correctScrollForStickyGrowth(36, () => 0, run.rescroll);
  assert.deepEqual(run.values, [0], "cleared pin re-scrolls with yMargin 0");
});

test("scheduleStickyScrollCorrection re-dispatches once after sticky appears", () => {
  let dispatched = 0;
  let height = 0;
  const view = {
    dom: {},
    dispatch() {
      dispatched++;
    },
  } as unknown as EditorView;

  const runs: Array<() => void> = [];
  scheduleStickyScrollCorrection(view, 100, 0, {
    measure: () => height,
    schedule: (run) => {
      runs.push(run);
    },
  });
  assert.equal(runs.length, 1, "one deferred correction");
  assert.equal(dispatched, 0, "no dispatch until the schedule fires");

  height = 40;
  runs[0]!();
  assert.equal(dispatched, 1, "one re-scroll after sticky height appears");

  assert.equal(runs.length, 1, "helper schedules at most once");
});

test("scheduleStickyScrollCorrection stays quiet when sticky height did not change", () => {
  let dispatched = 0;
  const view = {
    dom: {},
    dispatch() {
      dispatched++;
    },
  } as unknown as EditorView;
  const runs: Array<() => void> = [];
  scheduleStickyScrollCorrection(view, 100, 40, {
    measure: () => 40,
    schedule: (run) => runs.push(run),
  });
  runs[0]!();
  assert.equal(dispatched, 0);
});

test("scheduleStickyScrollCorrection skips work when a newer jump superseded it", () => {
  let dispatched = 0;
  let current = 1;
  const view = {
    dom: {},
    dispatch() {
      dispatched++;
    },
  } as unknown as EditorView;
  const runs: Array<() => void> = [];
  scheduleStickyScrollCorrection(view, 100, 0, {
    measure: () => 40,
    schedule: (run) => runs.push(run),
    isCurrent: () => current === 1,
  });
  current = 2;
  runs[0]!();
  assert.equal(dispatched, 0);
});

test("scrollTargetToTop first jump omits sticky yMargin and corrects from initialHeight 0", async () => {
  // Leftover pin from a prior nested scroll. Applying that height on the first
  // scrollIntoView is the clamp bug this helper refuses: production must start
  // at CM's default yMargin (omit sticky) and scheduleStickyScrollCorrection
  // with initialHeight 0 so a post-paint measure can still differ.
  const leftoverSticky = 40;
  const stickyEl = {
    hidden: false,
    getBoundingClientRect: () => ({ height: leftoverSticky }),
  };
  const dispatches: Array<{
    selection?: { anchor: number; head: number };
    effects?: unknown[];
  }> = [];
  const view = {
    dom: {
      querySelector: (sel: string) =>
        sel === ".mw-sticky-scroll" ? stickyEl : null,
    },
    dispatch(tr: {
      selection?: { anchor: number; head: number };
      effects?: unknown[];
    }) {
      dispatches.push(tr);
    },
  } as unknown as EditorView;

  scrollTargetToTop(view, { from: 12, to: 20 }, [], {
    isCurrent: () => true,
  });

  assert.equal(dispatches.length, 1, "one immediate dispatch");
  assert.deepEqual(dispatches[0]!.selection, { anchor: 12, head: 12 });
  const effects = dispatches[0]!.effects ?? [];
  assert.equal(effects.length, 1);
  const first = effects[0] as { value: { y: string; yMargin: number } };
  assert.equal(first.value.y, "start");
  assert.equal(
    first.value.yMargin,
    5,
    "first scroll must omit yMargin (CM default 5), not leftover sticky height",
  );
  assert.notEqual(
    first.value.yMargin,
    leftoverSticky,
    "leftover sticky height must not ride on the first scroll",
  );

  // defaultSchedule: double queueMicrotask when requestAnimationFrame is absent
  await new Promise<void>((resolve) => {
    queueMicrotask(() => queueMicrotask(resolve));
  });

  assert.equal(
    dispatches.length,
    2,
    "correction runs because initialHeight was 0, not leftover sticky; if production passed leftover as initialHeight, measure would match and skip",
  );
  // scheduleStickyScrollCorrection dispatches a single effect, not an array.
  const correctionEffects = dispatches[1]!.effects;
  const correction = (
    Array.isArray(correctionEffects) ? correctionEffects[0] : correctionEffects
  ) as { value: { y: string; yMargin: number } };
  assert.equal(correction.value.y, "start");
  assert.equal(correction.value.yMargin, leftoverSticky);
});

test("scrollTargetToTop refuses sticky-before-jump: matching leftover initialHeight would skip correction", () => {
  // Contract mirror of the production choice: if the first scroll had applied
  // leftover sticky height and passed that same value as initialHeight, a
  // still-present pin after paint would skip the corrective re-scroll. That
  // is the path that skewed start-of-note clamps; we keep initialHeight at 0.
  let rescrolls = 0;
  correctScrollForStickyGrowth(
    40,
    () => 40,
    () => {
      rescrolls++;
    },
  );
  assert.equal(rescrolls, 0, "leftover-as-initialHeight skips correction");

  rescrolls = 0;
  correctScrollForStickyGrowth(
    0,
    () => 40,
    () => {
      rescrolls++;
    },
  );
  assert.equal(rescrolls, 1, "initialHeight 0 still corrects when pin remains");
});

/** Let every look that chains onto the one before it run. */
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

function jumpView(options: {
  /** The sticky bar's height at each look, the last one for every later. */
  heights: number[];
  onDispatch?: () => void;
}) {
  let looks = 0;
  const sticky = {
    hidden: false,
    getBoundingClientRect: () => ({
      height: options.heights[Math.min(looks++, options.heights.length - 1)],
    }),
  };
  const view = {
    dom: {
      querySelector: (selector: string) =>
        selector === ".mw-sticky-scroll" ? sticky : null,
    },
    dispatch: () => options.onDispatch?.(),
  } as unknown as EditorView;
  return { view, looks: () => looks };
}

test("a sticky bar that appears after the first look is still corrected, and followed while it settles", () => {
  // The jump can arrive before the sticky feature has loaded; the bar then
  // draws over the line the jump put at the top, and its row height can still
  // change once the editor's line height is measured.
  const rescrolls: number[] = [];
  const runs: Array<() => void> = [];
  let height = 0;
  scheduleStickyScrollCorrection({} as EditorView, 100, 0, {
    measure: () => height,
    schedule: (run) => runs.push(run),
    keepWaiting: () => true,
    rescroll: (yMargin) => rescrolls.push(yMargin),
  });

  runs.shift()!();
  assert.deepEqual(rescrolls, [], "no bar yet");
  assert.equal(runs.length, 1, "it looks again");

  height = 22;
  runs.shift()!();
  assert.deepEqual(rescrolls, [22]);

  runs.shift()!();
  assert.deepEqual(rescrolls, [22], "unchanged: nothing to correct");

  height = 25;
  runs.shift()!();
  assert.deepEqual(rescrolls, [22, 25], "changed again: corrected again");
});

test("a sticky bar that keeps changing is corrected a few times, not for ever", () => {
  const rescrolls: number[] = [];
  const runs: Array<() => void> = [];
  let height = 0;
  scheduleStickyScrollCorrection({} as EditorView, 100, 0, {
    measure: () => (height += 1),
    schedule: (run) => runs.push(run),
    keepWaiting: () => true,
    rescroll: (yMargin) => rescrolls.push(yMargin),
  });
  while (runs.length > 0 && rescrolls.length < 1000) {
    runs.shift()!();
  }
  assert.ok(rescrolls.length > 1 && rescrolls.length < 10, `${rescrolls}`);
});

test("waiting for a sticky bar stops once nothing is held any more", () => {
  const rescrolls: number[] = [];
  const runs: Array<() => void> = [];
  let held = true;
  scheduleStickyScrollCorrection({} as EditorView, 100, 0, {
    measure: () => 0,
    schedule: (run) => runs.push(run),
    keepWaiting: () => held,
    rescroll: (yMargin) => rescrolls.push(yMargin),
  });
  runs.shift()!();
  assert.equal(runs.length, 1);
  // The reader scrolled: a bar that appears now belongs to where they are.
  held = false;
  runs.shift()!();
  assert.equal(runs.length, 0, "no further look");
  assert.deepEqual(rescrolls, []);
});

test("waiting for a sticky bar that never comes ends", () => {
  const runs: Array<() => void> = [];
  let looks = 0;
  scheduleStickyScrollCorrection({} as EditorView, 100, 0, {
    measure: () => 0,
    schedule: (run) => runs.push(run),
    keepWaiting: () => true,
    rescroll: () => assert.fail("no bar, no correction"),
  });
  while (runs.length > 0 && looks < 1000) {
    runs.shift()!();
    looks++;
  }
  assert.ok(looks > 1 && looks < 1000, `${looks} looks`);
});

test("without a way to wait the sticky bar is looked for once, as before", () => {
  const runs: Array<() => void> = [];
  scheduleStickyScrollCorrection({} as EditorView, 100, 0, {
    measure: () => 0,
    schedule: (run) => runs.push(run),
  });
  runs.shift()!();
  assert.equal(runs.length, 0);
});

test("scrollTargetToTop holds the target before it scrolls there, and the sticky bar moves that hold", async () => {
  const events: string[] = [];
  const moves: number[] = [];
  const { view } = jumpView({
    heights: [0, 0, 30],
    onDispatch: () => events.push("dispatch"),
  });

  scrollTargetToTop(view, { from: 12, to: 20 }, [], {
    isCurrent: () => true,
    holdAtTop: (position, yMargin) => {
      events.push(`hold ${position} ${yMargin}`);
      return {
        isHeld: () => true,
        move: (margin) => {
          moves.push(margin);
          return true;
        },
      };
    },
  });
  // The hold must exist when CodeMirror's measuring reaches the scroll.
  assert.deepEqual(events, ["hold 12 5", "dispatch"]);

  await drain();
  assert.deepEqual(moves, [30], "the late bar moved the hold, once");
  assert.deepEqual(
    events,
    ["hold 12 5", "dispatch"],
    "and was not a scroll that would have ended the hold",
  );
});

test("scrollTargetToTop stops waiting for the bar once the hold has ended", async () => {
  const moves: number[] = [];
  const { view, looks } = jumpView({ heights: [0, 0, 30] });
  scrollTargetToTop(view, { from: 12, to: 20 }, [], {
    isCurrent: () => true,
    holdAtTop: () => ({
      // The reader scrolls after the second look.
      isHeld: () => looks() < 2,
      move: (margin) => {
        moves.push(margin);
        return true;
      },
    }),
  });
  await drain();
  assert.equal(looks(), 2, "no look after the hold ended");
  assert.deepEqual(moves, [], "and a bar that comes later is left alone");
});
