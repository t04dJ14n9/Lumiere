import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

/** The hook as one engine session runs it, with the clock in the test's hands. */
function session(worker: boolean) {
  const hooks = fakeReact();
  const timers = new Map<number, () => void>();
  let next = 0;
  const module = loadHook(
    "engine-failure.ts",
    { react: hooks.react },
    {
      console: { warn: () => undefined },
      setTimeout: (run: () => void) => {
        timers.set(++next, run);
        return next;
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
  );
  const useEngineFailure = module.useEngineFailure as (options: {
    error: unknown;
    worker: boolean;
    answered: boolean;
    onWorkerFailure: () => void;
    report: (message: string) => void;
  }) => void;
  let fallbacks = 0;
  const reports: string[] = [];
  const onWorkerFailure = () => {
    fallbacks++;
  };
  const report = (message: string) => reports.push(message);
  const render = (state: { answered: boolean; error?: unknown }) =>
    hooks.render(() =>
      useEngineFailure({
        error: state.error,
        worker,
        answered: state.answered,
        onWorkerFailure,
        report,
      }),
    );
  /** Let the 15 s pass: every timer still set goes off. */
  const timeout = () => {
    for (const run of [...timers.values()]) {
      run();
    }
  };
  return {
    render,
    timeout,
    fallbacks: () => fallbacks,
    reports,
    isEngineFailure: module.isEngineFailure as (code: string) => boolean,
  };
}

test("a worker that never answers gives way to the main thread", () => {
  const { render, timeout, fallbacks } = session(true);
  render({ answered: false });
  timeout();
  assert.equal(fallbacks(), 1);
});

test("a locked or damaged PDF is the worker's answer: no timeout, no main-thread engine", () => {
  const { render, timeout, fallbacks } = session(true);
  render({ answered: false });
  // DocumentGate showed the password prompt, or the file's error.
  render({ answered: true });
  timeout();
  assert.equal(fallbacks(), 0);
});

test("only the engine's own failure is a reason to start the main-thread engine", () => {
  const { isEngineFailure } = session(true);
  assert.equal(isEngineFailure("operation-failed"), true);
  assert.equal(isEngineFailure("invalid-input"), false);
  assert.equal(isEngineFailure("permission-denied"), false);
});

test("a main-thread engine that fails is reported, and has nothing to fall back to", () => {
  const { render, timeout, fallbacks, reports } = session(false);
  render({ answered: false, error: new Error("no wasm") });
  timeout();
  assert.equal(fallbacks(), 0);
  assert.deepEqual(reports, ["The PDF engine failed: Error: no wasm"]);
});
