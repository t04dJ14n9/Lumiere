import test from "node:test";
import assert from "node:assert/strict";
import {
  hasTopLineOpen,
  isNativeSelectionOpen,
  nativeOpeningSelection,
  openRange,
  withNativeSelectionOpen,
} from "../../../src/host/native-selection-open";
import { nativeViewportTopLine } from "../../../src/host/reclaim-selection";

test("a Search range stays visible until the custom editor open finishes", async () => {
  const range = { at: 9, to: 34 };
  let during: { anchor: number; head: number } | undefined;
  await withNativeSelectionOpen(
    "file:///Note.md",
    1,
    () => range,
    async () => {
      during = nativeOpeningSelection("file:///Note.md", 1);
      assert.equal(isNativeSelectionOpen("file:///Note.md", 1), true);
    },
  );
  assert.deepEqual(during, { anchor: 9, head: 34 });
  assert.equal(nativeOpeningSelection("file:///Note.md", 1), undefined);
  assert.equal(isNativeSelectionOpen("file:///Note.md", 1), false);
});

test("a caret does not mark the open as a Search selection", async () => {
  await withNativeSelectionOpen(
    "file:///Note.md",
    1,
    () => ({ at: 0 }),
    async () => {
      assert.equal(isNativeSelectionOpen("file:///Note.md", 1), false);
      assert.equal(nativeOpeningSelection("file:///Note.md", 1), undefined);
    },
  );
});

test("openRange preserves topLine identity with the selection", () => {
  assert.deepEqual(openRange({ at: 9, to: 34, topLine: 12 }), {
    at: 9,
    to: 34,
    topLine: 12,
  });
  assert.deepEqual(openRange({ at: 9, to: undefined, topLine: 0 }), {
    at: 9,
    topLine: 0,
  });
  assert.equal(openRange({ at: undefined, to: 10, topLine: 3 }), undefined);
});

test("nativeOpeningSelection returns the exact topLine from the pending open", async () => {
  const range = { at: 40, to: 55, topLine: 12 };
  let during: { anchor: number; head: number; topLine?: number } | undefined;
  await withNativeSelectionOpen(
    "file:///Note.md",
    2,
    () => range,
    async () => {
      during = nativeOpeningSelection("file:///Note.md", 2);
      assert.equal(hasTopLineOpen("file:///Note.md", 2), true);
      assert.equal(isNativeSelectionOpen("file:///Note.md", 2), true);
    },
  );
  assert.deepEqual(during, { anchor: 40, head: 55, topLine: 12 });
  assert.equal(hasTopLineOpen("file:///Note.md", 2), false);
});

test("hasTopLineOpen treats topLine: 0 as a present pin", async () => {
  let during: { anchor: number; head: number; topLine?: number } | undefined;
  await withNativeSelectionOpen(
    "file:///Note.md",
    1,
    () => ({ at: 0, topLine: 0 }),
    async () => {
      during = nativeOpeningSelection("file:///Note.md", 1);
      assert.equal(hasTopLineOpen("file:///Note.md", 1), true);
    },
  );
  assert.deepEqual(during, { anchor: 0, head: 0, topLine: 0 });
});

test("a caret with topLine still yields an opening selection pin", async () => {
  let during: { anchor: number; head: number; topLine?: number } | undefined;
  await withNativeSelectionOpen(
    "file:///Note.md",
    1,
    () => ({ at: 0, topLine: 7 }),
    async () => {
      during = nativeOpeningSelection("file:///Note.md", 1);
      assert.equal(hasTopLineOpen("file:///Note.md", 1), true);
      assert.equal(isNativeSelectionOpen("file:///Note.md", 1), false);
    },
  );
  assert.deepEqual(during, { anchor: 0, head: 0, topLine: 7 });
});

test("nativeViewportTopLine is the first visible line identity", () => {
  assert.equal(
    nativeViewportTopLine([{ start: { line: 12 } }, { start: { line: 50 } }]),
    12,
  );
  assert.equal(nativeViewportTopLine([{ start: { line: 0 } }]), 0);
  assert.equal(nativeViewportTopLine([]), undefined);
  assert.equal(nativeViewportTopLine(undefined), undefined);
  assert.equal(nativeViewportTopLine([{ start: { line: -1 } }]), undefined);
});
