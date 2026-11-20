import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EngineHealth,
  engineHealth,
  watchEngine,
} from "../../src/webview/engine-health";
import { EngineHost } from "../../src/webview/engine-host";

const reject = (code: string, message: string) => ({
  kind: "reject",
  jobId: 1,
  error: { code, message },
});
const resolve = { kind: "resolve", jobId: 1, result: {} };

function watched() {
  const health = new EngineHealth();
  const causes: string[] = [];
  health.onDeath((cause) => causes.push(cause));
  return { health, causes };
}

test("a worker that raises an error has stopped, and says so once", () => {
  const { health, causes } = watched();
  assert.equal(health.cause, undefined);
  health.workerFailed("Uncaught RuntimeError: unreachable");
  health.workerFailed("again");
  assert.deepEqual(causes, ["Uncaught RuntimeError: unreachable"]);
  assert.equal(health.cause, "Uncaught RuntimeError: unreachable");
});

test("a call that fails because the runtime is gone, or PDFium trapped, stops the engine", () => {
  for (const [code, message] of [
    ["RuntimeUnavailable", "engine failed to boot"],
    ["Unknown", "memory access out of bounds"],
    ["Unknown", "unreachable"],
    ["Unknown", "Aborted(OOM)"],
    ["WireFormat", "could not decode"],
  ]) {
    const { health, causes } = watched();
    health.answered(resolve);
    health.answered(reject(code!, message!));
    assert.deepEqual(causes, [message], `${code} ${message}`);
  }
});

test("a call the file refuses, or that was cancelled, leaves the engine working", () => {
  const { health, causes } = watched();
  for (const answer of [
    reject("Aborted", "render aborted"),
    reject("InvalidArg", "page 9 does not exist"),
    reject("DocOpenFailed", "not a PDF"),
    reject("DocPasswordRequired", "locked"),
    resolve,
    { kind: "progress" },
    "not a response",
    null,
  ]) {
    health.answered(answer);
  }
  assert.deepEqual(causes, []);
  assert.equal(health.cause, undefined);
});

test("a listener added after the engine stopped hears it at once; one removed hears nothing", () => {
  const health = new EngineHealth();
  const early: string[] = [];
  const stop = health.onDeath((cause) => early.push(cause));
  stop();
  health.workerFailed("gone");
  const late: string[] = [];
  health.onDeath((cause) => late.push(cause));
  assert.deepEqual(early, []);
  assert.deepEqual(late, ["gone"]);
});

test("each engine has its own health, found from the engine", () => {
  const engine = {};
  const health = watchEngine(engine);
  assert.equal(engineHealth(engine), health);
  assert.equal(engineHealth({}), undefined);
});

test("an engine that stopped working is let go: the next ask starts a new one", async () => {
  const created: number[] = [];
  const destroyed: number[] = [];
  let next = 0;
  const host = new EngineHost<{ id: number }>({
    create: async () => {
      created.push(++next);
      return { id: next };
    },
    destroy: async (engine) => {
      destroyed.push(engine.id);
    },
    reportError: () => undefined,
  });
  const dead = await host.engine("worker");
  host.restart();
  const fresh = await host.engine("worker");
  assert.notEqual(fresh, dead);
  assert.deepEqual(created, [1, 2]);
  assert.deepEqual(destroyed, [1]);
});
