import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOSAVE_INTERVAL_MS,
  AutosaveScheduler,
  type AutosaveClock,
} from "./autosave";

interface Pending {
  delayMs: number;
  run: () => void;
  cancelled: boolean;
}

function fakeClock(): { clock: AutosaveClock; pending: Pending[] } {
  const pending: Pending[] = [];
  const clock: AutosaveClock = {
    schedule(delayMs, run) {
      const entry: Pending = { delayMs, run, cancelled: false };
      pending.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
  return { clock, pending };
}

function tick(pending: Pending[], index = 0): void {
  const entry = pending[index];
  assert.ok(entry, `no timer scheduled at index ${index}`);
  assert.equal(entry.cancelled, false, "timer was cancelled");
  entry.run();
}

test("a dirty saved note is saved on the two-second cadence", async () => {
  const { clock, pending } = fakeClock();
  let saves = 0;
  const scheduler = new AutosaveScheduler({
    clock,
    isDirty: () => true,
    isUntitled: () => false,
    save: async () => {
      saves++;
      return true;
    },
  });
  scheduler.start();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.delayMs, AUTOSAVE_INTERVAL_MS);
  assert.equal(saves, 0, "nothing saves before the first tick");

  await Promise.resolve();
  tick(pending, 0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(saves, 1);
  assert.equal(pending.length, 2, "the next tick is armed after the save");
  scheduler.dispose();
  assert.equal(pending[1]!.cancelled, true, "dispose cancels the next tick");
});

test("clean and untitled documents are never saved, but the timer keeps ticking", async () => {
  const { clock, pending } = fakeClock();
  let saves = 0;
  let dirty = false;
  let untitled = false;
  const scheduler = new AutosaveScheduler({
    clock,
    isDirty: () => dirty,
    isUntitled: () => untitled,
    save: async () => {
      saves++;
      return true;
    },
  });
  scheduler.start();
  tick(pending, 0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(saves, 0);

  dirty = true;
  untitled = true;
  tick(pending, 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(saves, 0, "an untitled note is left alone");

  untitled = false;
  tick(pending, 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(saves, 1, "a dirty saved note is saved");
  scheduler.dispose();
});

test("dispose before the first tick prevents any save", async () => {
  const { clock, pending } = fakeClock();
  let saves = 0;
  const scheduler = new AutosaveScheduler({
    clock,
    isDirty: () => true,
    isUntitled: () => false,
    save: async () => {
      saves++;
      return true;
    },
  });
  scheduler.start();
  scheduler.dispose();
  assert.equal(pending[0]!.cancelled, true, "dispose cancels the pending tick");
  // Even if a stray callback runs after dispose, it must not save or re-arm.
  pending[0]!.run();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(saves, 0);
  assert.equal(pending.length, 1, "no further tick is armed");
});

test("a slow save is not overlapped by another tick", async () => {
  const { clock, pending } = fakeClock();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saves = 0;
  const scheduler = new AutosaveScheduler({
    clock,
    isDirty: () => true,
    isUntitled: () => false,
    save: async () => {
      saves++;
      await gate;
      return true;
    },
  });
  scheduler.start();
  tick(pending, 0);
  // A second tick cannot be armed until the first save settles.
  assert.equal(pending.length, 1);
  assert.equal(saves, 1);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  scheduler.dispose();
});
