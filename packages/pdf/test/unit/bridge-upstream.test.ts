import assert from "node:assert/strict";
import { test } from "node:test";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Upstream } from "../../src/bridge-stdio/upstream";

/**
 * The stdio shim's connection to a window's bridge, against bridges that
 * stop as a window does when it closes or reloads.
 */

const call = (id: number): JSONRPCMessage => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "get_selection" },
});

/** fetch's error when nothing listens on the port. */
function refused(): Error {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:50123"), {
      code: "ECONNREFUSED",
    }),
  });
}

/** Windows whose bridges the shim may choose, one after another. */
function windows() {
  const received: string[] = [];
  const stopped = new Set<string>();
  const opened: string[] = [];
  let current = "window 1";
  const link = (name: string) => ({
    name,
    send: async (message: JSONRPCMessage) => {
      if (stopped.has(name)) {
        throw refused();
      }
      received.push(`${name} ${"id" in message ? message.id : "-"}`);
    },
  });
  const upstream = new Upstream(async () => {
    opened.push(current);
    return link(current);
  });
  return {
    upstream,
    received,
    opened,
    /** The window reloads: its bridge stops, and a new one starts. */
    reload(next: string) {
      stopped.add(current);
      current = next;
    },
    close() {
      stopped.add(current);
    },
  };
}

test("after the window reloads, the next call goes to its new bridge, not to an error", async () => {
  const { upstream, received, opened, reload } = windows();
  await upstream.send(call(1));
  reload("window 1, reloaded");
  await upstream.send(call(2));
  await upstream.send(call(3));
  assert.deepEqual(received, [
    "window 1 1",
    "window 1, reloaded 2",
    "window 1, reloaded 3",
  ]);
  assert.deepEqual(opened, ["window 1", "window 1, reloaded"]);
});

test("after the window closes, a call fails once and is not sent anywhere twice", async () => {
  const { upstream, received, close } = windows();
  await upstream.send(call(1));
  close();
  await assert.rejects(upstream.send(call(2)), /fetch failed/);
  assert.deepEqual(received, ["window 1 1"]);
});

test("an error from a bridge that got the call is the answer, not a reason to send it again", async () => {
  let sends = 0;
  const upstream = new Upstream(async () => ({
    send: async () => {
      sends += 1;
      throw new Error("Error POSTing to endpoint (HTTP 500)");
    },
  }));
  await assert.rejects(upstream.send(call(1)), /HTTP 500/);
  await assert.rejects(upstream.send(call(2)), /HTTP 500/);
  assert.equal(sends, 2);
});

test("calls that arrive together share one connection", async () => {
  let opened = 0;
  const upstream = new Upstream(async () => {
    opened += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { send: async () => undefined };
  });
  await Promise.all([upstream.send(call(1)), upstream.send(call(2))]);
  assert.equal(opened, 1);
});

test("a dropped connection is chosen again; dropping an old one keeps the new", async () => {
  const links: { send: () => Promise<void> }[] = [];
  const upstream = new Upstream(async () => {
    const link = { send: async () => undefined };
    links.push(link);
    return link;
  });
  await upstream.send(call(1));
  upstream.drop(links[0]!);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await upstream.send(call(2));
  assert.equal(links.length, 2);
  upstream.drop(links[0]!);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await upstream.send(call(3));
  assert.equal(links.length, 2);
});
