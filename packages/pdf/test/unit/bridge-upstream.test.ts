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

/** fetch's error when the socket fails: refused, or cut as the process ends. */
function transportFailure(code: "ECONNREFUSED" | "UND_ERR_SOCKET"): Error {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(`socket: ${code}`), { code }),
  });
}

/** Windows whose bridges the shim may choose, one after another. */
function windows() {
  const received: string[] = [];
  const stopped = new Set<string>();
  const opened: string[] = [];
  let current = "window 1";
  // A pooled connection to a process that just ended is cut, not refused.
  let failure: "ECONNREFUSED" | "UND_ERR_SOCKET" = "ECONNREFUSED";
  const link = (name: string) => ({
    name,
    send: async (message: JSONRPCMessage) => {
      if (stopped.has(name)) {
        throw transportFailure(failure);
      }
      received.push(`${name} ${"id" in message ? message.id : "-"}`);
    },
  });
  const upstream = new Upstream({
    open: async () => {
      opened.push(current);
      // As chooseBridge: a closed window's record is gone.
      if (stopped.has(current)) {
        throw new Error("No VS Code or Cursor window has the folder");
      }
      return link(current);
    },
    isGone: ({ name }) => stopped.has(name),
  });
  return {
    upstream,
    received,
    opened,
    cutOnExit() {
      failure = "UND_ERR_SOCKET";
    },
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

test("after the window reloads, a call over a connection its exit cut goes to the new bridge too", async () => {
  const { upstream, received, reload, cutOnExit } = windows();
  await upstream.send(call(1));
  cutOnExit();
  reload("window 1, reloaded");
  await upstream.send(call(2));
  assert.deepEqual(received, ["window 1 1", "window 1, reloaded 2"]);
});

test("after the only window closes, a call is told no window has the folder, and is sent nowhere", async () => {
  const { upstream, received, close, opened } = windows();
  await upstream.send(call(1));
  close();
  await assert.rejects(upstream.send(call(2)), /No VS Code or Cursor window/);
  assert.deepEqual(received, ["window 1 1"]);
  assert.deepEqual(opened, ["window 1", "window 1"]);
});

test("a transport failure to a bridge still running is the answer, not a reason to send it again", async () => {
  let sends = 0;
  const upstream = new Upstream({
    open: async () => ({
      send: async () => {
        sends += 1;
        if (sends > 1) {
          throw transportFailure("UND_ERR_SOCKET");
        }
      },
    }),
    isGone: () => false,
  });
  await upstream.send(call(1));
  await assert.rejects(upstream.send(call(2)), /fetch failed/);
  assert.equal(sends, 2);
});

test("an error from a bridge that got the call is the answer, not a reason to send it again", async () => {
  let sends = 0;
  const upstream = new Upstream({
    open: async () => ({
      send: async () => {
        sends += 1;
        throw new Error("Error POSTing to endpoint (HTTP 500)");
      },
    }),
    isGone: () => true,
  });
  await assert.rejects(upstream.send(call(1)), /HTTP 500/);
  await assert.rejects(upstream.send(call(2)), /HTTP 500/);
  assert.equal(sends, 2);
});

test("calls that arrive together share one connection", async () => {
  let opened = 0;
  const upstream = new Upstream({
    open: async () => {
      opened += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { send: async () => undefined };
    },
    isGone: () => false,
  });
  await Promise.all([upstream.send(call(1)), upstream.send(call(2))]);
  assert.equal(opened, 1);
});

test("a dropped connection is chosen again; dropping an old one keeps the new", async () => {
  type Link = { send: () => Promise<void> };
  const links: Link[] = [];
  const upstream = new Upstream<Link>({
    open: async () => {
      const link: Link = { send: async () => undefined };
      links.push(link);
      return link;
    },
    isGone: () => false,
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
