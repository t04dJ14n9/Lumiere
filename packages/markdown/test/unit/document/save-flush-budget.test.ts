import { provideHostServices } from "../../../src/shared/host";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { documentHost } from "../../../src/plugins/document/host";
import { Session } from "../../../src/plugins/document/session";
import { callFailed, type Endpoint } from "../../../src/shared/rpc/endpoint";
import type { Documents } from "../../../src/plugins/document/api";
import type { HostDocument } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

/** VS Code gives every save listener together 1.5 s; Lumiere takes 1.2 s of it. */
const BUDGET = 1200;

/**
 * A panel that takes `latency` ms to answer a flush, or never answers when it
 * is `undefined`. The clock is faked and moves by what each request waited;
 * `timeouts` collects the `timeout` each flush request was given.
 */
function fakePanel(
  t: TestContext,
  latency: number | undefined,
  timeouts: number[],
): Endpoint {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  return {
    handle: () => () => {},
    call(
      _protocol: unknown,
      method: string,
      _params: unknown,
      options: { timeout: number },
    ) {
      assert.equal(method, "flush");
      timeouts.push(options.timeout);
      if (latency !== undefined && latency <= options.timeout) {
        t.mock.timers.tick(latency);
        return Promise.resolve(true);
      }
      t.mock.timers.tick(options.timeout);
      return Promise.reject(callFailed.timeout(method, options.timeout));
    },
  } as unknown as Endpoint;
}

/** A native save of a note with one panel; the time the whole save took. */
async function nativeSave(
  t: TestContext,
  latency: number | undefined,
): Promise<{ timeouts: number[]; elapsed: number }> {
  let willSave!: (document: HostDocument) => Promise<void>;
  const host = fakeHost({
    hostDocuments: {
      onWillSave(listener) {
        willSave = listener;
        return () => {};
      },
    },
  });
  const root = createRoot();
  provideHostServices(root, host);
  root.plugin(documentHost);
  await root.settled();
  t.after(() => root.dispose());
  const doc = fakeDocument();
  const session = (root.service("documents") as Documents).session(doc);
  const timeouts: number[] = [];
  session.attach("panel", fakePanel(t, latency, timeouts));

  await willSave(doc);
  return { timeouts, elapsed: Date.now() };
}

test("a native save waits for a panel that never answers one budget in all, not once per flush", async (t) => {
  const { timeouts, elapsed } = await nativeSave(t, undefined);

  // The listener's flush spends the budget; the one after it has none left.
  assert.deepEqual(timeouts, [BUDGET, 0]);
  assert.equal(elapsed, BUDGET);
});

test("the flush after the listeners gets only the time the first one left", async (t) => {
  const { timeouts, elapsed } = await nativeSave(t, 300);

  assert.deepEqual(timeouts, [BUDGET, BUDGET - 300]);
  assert.equal(elapsed, 600);
});

test("a flush with no deadline of its own, such as Undo's, waits one whole budget", async (t) => {
  const timeouts: number[] = [];
  const session = new Session(fakeDocument(), fakeHost());
  session.attach("panel", fakePanel(t, undefined, timeouts));

  await assert.rejects(session.flush("panel"), /Timeout|timed out/i);
  await session.flush();

  assert.deepEqual(timeouts, [BUDGET, BUDGET]);
});
