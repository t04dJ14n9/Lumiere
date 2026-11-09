import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EngineHost,
  EngineHostDisposedError,
  type EngineEnvironment,
  type EngineMode,
} from "../../src/webview/engine-host";

interface FakeEngine {
  mode: EngineMode;
  destroyed: boolean;
}

/** An environment whose engines start, and stop, only when the test says so. */
function environment() {
  const starting: {
    engine: FakeEngine;
    resolve: (engine: FakeEngine) => void;
    reject: (error: Error) => void;
  }[] = [];
  const stopping: { engine: FakeEngine; resolve: () => void }[] = [];
  const created: EngineMode[] = [];
  const reported: string[] = [];
  let stopFails = false;
  const env: EngineEnvironment<FakeEngine> = {
    create: (mode) =>
      new Promise((resolve, reject) => {
        created.push(mode);
        starting.push({
          engine: { mode, destroyed: false },
          resolve,
          reject,
        });
      }),
    destroy: (engine) =>
      new Promise((resolve, reject) => {
        if (stopFails) {
          reject(new Error("stuck"));
          return;
        }
        stopping.push({
          engine,
          resolve: () => {
            engine.destroyed = true;
            resolve();
          },
        });
      }),
    reportError: (message, error) => {
      reported.push(`${message}: ${String(error)}`);
    },
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  };
  return {
    env,
    created,
    reported,
    settle,
    failStops: () => {
      stopFails = true;
    },
    /** Finish starting the oldest engine still starting. */
    async finishStart(): Promise<FakeEngine> {
      await settle();
      const next = starting.shift();
      if (!next) {
        throw new Error("no engine is starting");
      }
      next.resolve(next.engine);
      await settle();
      return next.engine;
    },
    async failStart(error: Error): Promise<void> {
      await settle();
      starting.shift()?.reject(error);
      await settle();
    },
    /** Finish stopping the oldest engine still stopping. */
    async finishStop(): Promise<void> {
      await settle();
      stopping.shift()?.resolve();
      await settle();
    },
  };
}

test("an engine lives for the whole webview: the same mode answers with the same engine", async () => {
  const { env, finishStart, created } = environment();
  const host = new EngineHost(env);
  const first = host.engine("worker");
  const started = await finishStart();
  assert.equal(await first, started);
  // A reload asks again: no second engine.
  assert.equal(await host.engine("worker"), started);
  assert.deepEqual(created, ["worker"]);
});

test("another mode starts only after the live engine has stopped", async () => {
  const { env, finishStart, finishStop, created, settle } = environment();
  const host = new EngineHost(env);
  void host.engine("worker");
  const worker = await finishStart();
  const main = host.engine("main-thread");
  await settle();
  assert.deepEqual(created, ["worker"], "waits for the worker to stop");
  assert.equal(worker.destroyed, false);
  await finishStop();
  assert.equal(worker.destroyed, true);
  const started = await finishStart();
  assert.equal(await main, started);
  assert.deepEqual(created, ["worker", "main-thread"]);
});

test("an engine given up on while it starts is stopped on arrival, never handed out", async () => {
  const { env, finishStart, finishStop, created, settle } = environment();
  const host = new EngineHost(env);
  const worker = host.engine("worker");
  const rejected = assert.rejects(worker, EngineHostDisposedError);
  await settle();
  const main = host.engine("main-thread");
  const late = await finishStart();
  await rejected;
  await finishStop();
  assert.equal(late.destroyed, true);
  assert.equal(late.mode, "worker");
  const started = await finishStart();
  assert.equal(await main, started);
  assert.deepEqual(created, ["worker", "main-thread"]);
});

test("an engine asked for and given up before its turn is never made", async () => {
  const { env, finishStart, finishStop, created } = environment();
  const host = new EngineHost(env);
  void host.engine("worker");
  const first = await finishStart();
  const skipped = assert.rejects(
    host.engine("main-thread"),
    EngineHostDisposedError,
  );
  const again = host.engine("worker");
  await finishStop();
  await skipped;
  const second = await finishStart();
  assert.equal(first.destroyed, true);
  assert.equal(await again, second);
  assert.deepEqual(created, ["worker", "worker"], "no main-thread engine");
});

test("an engine that fails to start is forgotten: the next ask tries again", async () => {
  const { env, failStart, finishStart, created } = environment();
  const host = new EngineHost(env);
  const failed = host.engine("main-thread");
  const failure = assert.rejects(failed, /offline/);
  await failStart(new Error("offline"));
  await failure;
  const retry = host.engine("main-thread");
  const started = await finishStart();
  assert.equal(await retry, started);
  assert.deepEqual(created, ["main-thread", "main-thread"]);
});

test("dispose stops the engine, resolves when it has, and refuses new asks", async () => {
  const { env, finishStart, finishStop, settle } = environment();
  const host = new EngineHost(env);
  void host.engine("worker");
  const engine = await finishStart();
  let done = false;
  const disposed = host.dispose().then(() => {
    done = true;
  });
  await settle();
  assert.equal(done, false, "waits for the stop");
  await finishStop();
  await disposed;
  assert.equal(engine.destroyed, true);
  await assert.rejects(host.engine("worker"), EngineHostDisposedError);
  await host.dispose();
});

test("a failing stop is reported, and does not keep the next engine from starting", async () => {
  const { env, finishStart, failStops, reported } = environment();
  const host = new EngineHost(env);
  void host.engine("worker");
  await finishStart();
  failStops();
  const main = host.engine("main-thread");
  const started = await finishStart();
  assert.equal(await main, started);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /Could not stop the PDF engine: .*stuck/);
});

test("an engine that never stops does not keep the next one from starting", async () => {
  const { env, finishStart, reported } = environment();
  const host = new EngineHost(env, 5);
  void host.engine("worker");
  await finishStart();
  // The fake never finishes this stop: it waits for finishStop().
  const main = host.engine("main-thread");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const started = await finishStart();
  assert.equal(await main, started);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /Could not stop the PDF engine: .*no answer/);
});
