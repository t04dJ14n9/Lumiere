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

  scrollTargetToTop(view, { from: 12, to: 20 }, [], () => true);

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
