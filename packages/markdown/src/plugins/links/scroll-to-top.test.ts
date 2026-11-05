import assert from "node:assert/strict";
import test from "node:test";
import type { EditorView } from "@codemirror/view";
import {
  correctScrollForStickyGrowth,
  scheduleStickyScrollCorrection,
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
