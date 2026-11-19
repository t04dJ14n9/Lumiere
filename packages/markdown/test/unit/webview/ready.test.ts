import test from "node:test";
import assert from "node:assert/strict";
import { requestReady } from "../../../src/webview/ready";
import {
  RpcError,
  callFailed,
  type Endpoint,
} from "../../../src/shared/rpc/endpoint";

function host(failures: readonly Error[]) {
  let calls = 0;
  const rpc = {
    call: async () => {
      const failure = failures[calls++];
      if (failure) {
        throw failure;
      }
      return { text: "# Note" };
    },
  } as unknown as Pick<Endpoint, "call">;
  return { rpc, calls: () => calls };
}

test("a busy host that misses the ready timeout is asked again", async () => {
  const busy = host([callFailed.timeout("ready", 10_000)]);
  assert.deepEqual(await requestReady(busy.rpc), { text: "# Note" });
  assert.equal(busy.calls(), 2);
});

test("ready gives up after its last try, and at once on any other failure", async () => {
  const stalled = host([
    callFailed.timeout("ready", 10_000),
    callFailed.timeout("ready", 10_000),
    callFailed.timeout("ready", 10_000),
  ]);
  await assert.rejects(requestReady(stalled.rpc), { code: "Timeout" });
  assert.equal(stalled.calls(), 3);

  const refused = host([new RpcError("HandlerFailed", "no such note")]);
  await assert.rejects(requestReady(refused.rpc), { code: "HandlerFailed" });
  assert.equal(refused.calls(), 1);
});
