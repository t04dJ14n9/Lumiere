import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLICK_SLOP_PX,
  createDeferredOpen,
  DOUBLE_CLICK_MS,
  isOpenClick,
  type ClickGesture,
  type Timers,
} from "../../src/shared/backlink-click";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function click(overrides: Partial<ClickGesture> = {}): ClickGesture {
  return {
    pressedAt: { x: 100, y: 200 },
    clickedAt: { x: 100, y: 200 },
    detail: 1,
    hasSelection: false,
    ...overrides,
  };
}

test("a still, lone click with nothing selected opens the note", () => {
  assert.equal(isOpenClick(click()), true);
});

test("a click that moves a few pixels is still a click", () => {
  assert.equal(
    isOpenClick(click({ clickedAt: { x: 100 + CLICK_SLOP_PX, y: 200 } })),
    true,
  );
  assert.equal(isOpenClick(click({ clickedAt: { x: 101, y: 201 } })), true);
});

test("a drag along the line is a selection, not a click", () => {
  assert.equal(
    isOpenClick(click({ clickedAt: { x: 100 + CLICK_SLOP_PX + 1, y: 200 } })),
    false,
  );
  assert.equal(isOpenClick(click({ clickedAt: { x: 100, y: 240 } })), false);
  // Distance is straight-line, not per axis.
  assert.equal(isOpenClick(click({ clickedAt: { x: 103, y: 203 } })), false);
});

test("the second and later clicks of a double or triple click do not open", () => {
  assert.equal(isOpenClick(click({ detail: 2 })), false);
  assert.equal(isOpenClick(click({ detail: 3 })), false);
});

test("a click with no click count (a synthetic or keyboard click) does not open", () => {
  assert.equal(isOpenClick(click({ detail: 0 })), false);
});

test("a click that leaves a text selection does not open", () => {
  assert.equal(isOpenClick(click({ hasSelection: true })), false);
});

test("a click whose press was not seen has nothing to say it was a drag", () => {
  assert.equal(isOpenClick(click({ pressedAt: undefined })), true);
  assert.equal(
    isOpenClick(click({ pressedAt: undefined, hasSelection: true })),
    false,
  );
});

/** Timers the test winds forward by hand. */
function fakeTimers(): Timers & {
  advance(ms: number): void;
  readonly waiting: number;
} {
  let now = 0;
  let nextHandle = 1;
  const waiting = new Map<number, { at: number; run: () => void }>();
  return {
    set(run, delayMs) {
      const handle = nextHandle++;
      waiting.set(handle, { at: now + delayMs, run });
      return handle;
    },
    clear(handle) {
      waiting.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...waiting]) {
        if (timer.at <= now) {
          waiting.delete(handle);
          timer.run();
        }
      }
    },
    get waiting() {
      return waiting.size;
    },
  };
}

test("a lone click opens once the double-click interval has passed", () => {
  const timers = fakeTimers();
  const deferred = createDeferredOpen(timers);
  let opened = 0;
  deferred.schedule(() => opened++);
  timers.advance(DOUBLE_CLICK_MS - 1);
  assert.equal(opened, 0);
  timers.advance(1);
  assert.equal(opened, 1);
  timers.advance(10 * DOUBLE_CLICK_MS);
  assert.equal(opened, 1);
});

test("a second press inside the interval calls the open off", () => {
  const timers = fakeTimers();
  const deferred = createDeferredOpen(timers);
  let opened = 0;
  deferred.schedule(() => opened++);
  timers.advance(DOUBLE_CLICK_MS / 2);
  deferred.cancel();
  timers.advance(10 * DOUBLE_CLICK_MS);
  assert.equal(opened, 0);
  assert.equal(timers.waiting, 0);
});

test("scheduling again replaces the open that was waiting", () => {
  const timers = fakeTimers();
  const deferred = createDeferredOpen(timers);
  const opened: string[] = [];
  deferred.schedule(() => opened.push("first"));
  timers.advance(DOUBLE_CLICK_MS - 1);
  deferred.schedule(() => opened.push("second"));
  timers.advance(DOUBLE_CLICK_MS - 1);
  assert.deepEqual(opened, []);
  timers.advance(1);
  assert.deepEqual(opened, ["second"]);
});

test("cancelling with nothing waiting, or after the open, does nothing", () => {
  const timers = fakeTimers();
  const deferred = createDeferredOpen(timers, 50);
  deferred.cancel();
  let opened = 0;
  deferred.schedule(() => opened++);
  timers.advance(50);
  deferred.cancel();
  assert.equal(opened, 1);
});

test("a double-click: the first click waits, the second press cancels it", () => {
  const timers = fakeTimers();
  const deferred = createDeferredOpen(timers);
  let opened = 0;
  // click 1: pointerdown, click (detail 1) schedules the open.
  deferred.cancel();
  assert.equal(isOpenClick(click({ detail: 1 })), true);
  deferred.schedule(() => opened++);
  timers.advance(120);
  // click 2: pointerdown cancels; its click (detail 2) is not an open click.
  deferred.cancel();
  assert.equal(isOpenClick(click({ detail: 2 })), false);
  timers.advance(10 * DOUBLE_CLICK_MS);
  assert.equal(opened, 0);
});

test("the overlay opens through the click gate and goes passive in Annotate", () => {
  const overlay = readFileSync(
    path.join(root, "src/webview/backlink-overlay.tsx"),
    "utf8",
  );
  assert.match(overlay, /isOpenClick\(gesture\)/u);
  // The only place a note is opened from is behind that gate and its wait.
  assert.equal(overlay.match(/openBacklinkNote/gu)?.length, 1);
  assert.match(overlay, /pending\.schedule\(/u);
  assert.match(overlay, /is-passive/u);

  const page = readFileSync(path.join(root, "src/webview/page.tsx"), "utf8");
  assert.match(page, /<BacklinkLayer[^>]*annotate=\{annotate\}/u);

  const css = readFileSync(
    path.join(root, "src/webview/styles/page.css"),
    "utf8",
  );
  assert.match(
    css,
    /\.pdf-backlink-overlay\.is-passive \.pdf-backlink-overlay-line\s*\{[^}]*pointer-events:\s*none/u,
  );
});
