import test from "node:test";
import assert from "node:assert/strict";
import { runFeaturePhases } from "../../../src/webview/feature-phases";
import type { FeaturePhase } from "../../../src/webview/features";

function run(preloaded: boolean, paint: Promise<void> = Promise.resolve()) {
  const events: string[] = [];
  return {
    events,
    promise: runFeaturePhases({
      chromeChunks: Promise.resolve(),
      startPaint: () => {
        events.push("start paint");
        return paint;
      },
      configure: async (phase: FeaturePhase) => {
        events.push(`configure ${phase}`);
      },
      mark: (name) => events.push(name),
      preloaded,
    }),
  };
}

test("preloaded chunks are configured in one step, chrome included", async () => {
  const started = run(true);
  await started.promise;
  assert.deepEqual(started.events, [
    "start paint",
    "configure paint",
    "mw:properties",
    "mw:features",
    "configure all",
  ]);
});

test("chunks that may arrive late configure chrome before waiting for the rest", async () => {
  let arrive!: () => void;
  const late = new Promise<void>((resolve) => (arrive = resolve));
  const started = run(false, late);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(started.events, [
    "start paint",
    "configure chrome",
    "mw:properties",
  ]);
  arrive();
  await started.promise;
  assert.deepEqual(started.events.slice(3), [
    "configure paint",
    "mw:features",
    "configure all",
  ]);
});

test("a failed phase stops the later ones and reaches the caller", async () => {
  await assert.rejects(
    runFeaturePhases({
      chromeChunks: Promise.reject(new Error("offline")),
      startPaint: () => Promise.resolve(),
      configure: () => assert.fail("nothing to configure"),
      mark: () => {},
      preloaded: false,
    }),
    /offline/,
  );
});
