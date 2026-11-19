import test from "node:test";
import assert from "node:assert/strict";
import {
  QueryClient,
  type SearchUpdate,
} from "../../../src/plugins/search/client";
import {
  protocol,
  type SearchResponse,
} from "../../../src/plugins/search/protocol";
import type { Cancellation } from "../../../src/shared/rpc/lifecycle";
import { rpcPair } from "../../support/rpc-pair";
import { Endpoint } from "../../../src/shared/rpc/endpoint";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test("query refresh cancels the old request and ignores late replies", async () => {
  const pair = rpcPair();
  const jobs: { resolve(value: SearchResponse): void; token: Cancellation }[] =
    [];
  pair.host.handle(
    protocol,
    "query",
    (_request, token) =>
      new Promise<SearchResponse>((resolve) => jobs.push({ resolve, token })),
  );
  const updates: SearchUpdate[] = [];
  const client = new QueryClient(pair.client);
  const stop = client.watch("tag:project", "file:///Note.md", (value) =>
    updates.push(value),
  );
  await tick();
  client.refresh();
  await tick();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]!.token.cancelled, true);
  jobs[0]!.resolve({
    results: [{ path: "Old.md", href: "Old.md" }],
    unreadable: 0,
  });
  await tick();
  assert.deepEqual(updates.at(-1), { loading: true });
  jobs[1]!.resolve({
    results: [{ path: "New.md", href: "New.md" }],
    unreadable: 0,
  });
  await tick();
  assert.deepEqual(updates.at(-1), {
    loading: false,
    results: [{ path: "New.md", href: "New.md" }],
    unreadable: 0,
  });
  stop();
  const count = updates.length;
  client.refresh();
  assert.equal(updates.length, count);
  client.watch("x", "file:///Note.md", (value) => updates.push(value));
  await tick();
  client.dispose();
  await tick();
  assert.equal(jobs.at(-1)!.token.cancelled, true);
  jobs.at(-1)!.resolve({ results: [], unreadable: 0 });
  await pair.dispose();
});
test("partial notifications paint matches while loading for the matching id", async () => {
  const pair = rpcPair();
  const jobs: {
    id: string | undefined;
    resolve(value: SearchResponse): void;
    token: Cancellation;
  }[] = [];
  pair.host.handle(protocol, "query", (request, token) => {
    return new Promise<SearchResponse>((resolve) =>
      jobs.push({ id: request.id, resolve, token }),
    );
  });
  const updates: SearchUpdate[] = [];
  const client = new QueryClient(pair.client);
  const stop = client.watch("meeting", "file:///Note.md", (value) =>
    updates.push(value),
  );
  await tick();
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0]!.id);
  pair.host.notify(protocol, "partial", {
    id: jobs[0]!.id!,
    results: [{ path: "A.md", href: "A.md" }],
    unreadable: 0,
  });
  await tick();
  assert.deepEqual(updates.at(-1), {
    loading: true,
    added: [{ path: "A.md", href: "A.md" }],
    unreadable: 0,
  });
  pair.host.notify(protocol, "partial", {
    id: "other-id",
    results: [{ path: "Ignored.md", href: "Ignored.md" }],
    unreadable: 0,
  });
  await tick();
  assert.deepEqual(updates.at(-1), {
    loading: true,
    added: [{ path: "A.md", href: "A.md" }],
    unreadable: 0,
  });
  jobs[0]!.resolve({
    results: [
      { path: "A.md", href: "A.md" },
      { path: "B.md", href: "B.md" },
    ],
    unreadable: 0,
  });
  await tick();
  assert.deepEqual(updates.at(-1), {
    loading: false,
    results: [
      { path: "A.md", href: "A.md" },
      { path: "B.md", href: "B.md" },
    ],
    unreadable: 0,
  });
  stop();
  client.dispose();
  await pair.dispose();
});
test("search protocol rejects invalid request and result shapes", () => {
  assert.doesNotThrow(() =>
    protocol.requests.query.params.parse({
      query: "foo",
      source: "file:///Note.md",
    }),
  );
  assert.doesNotThrow(() =>
    protocol.requests.query.params.parse({
      query: "foo",
      source: "file:///Note.md",
      id: "q1",
    }),
  );
  assert.throws(() =>
    protocol.requests.query.params.parse({
      query: "foo",
      source: "file:///Note.md",
      id: "",
    }),
  );
  assert.throws(() =>
    protocol.requests.query.params.parse({
      query: "foo",
      source: "file:///Note.md",
      id: -1,
    }),
  );
  assert.throws(() =>
    protocol.notifications.partial.parse({
      id: "q1",
      results: [{ path: "One.md" }],
      unreadable: 0,
    }),
  );
  assert.throws(() =>
    protocol.requests.query.result.parse({
      results: [{ path: "One.md" }],
      unreadable: 0,
    }),
  );
  assert.throws(() =>
    protocol.requests.query.result.parse({ results: [], unreadable: -1 }),
  );
});

/** Endpoints whose timers fire only when the test advances the clock. */
function manualClockPair() {
  const timers = new Set<{ at: number; fire(): void }>();
  let now = 0;
  const clock = {
    after(ms: number, fire: () => void) {
      const timer = { at: now + ms, fire };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
  };
  let hostReceive = (_value: unknown) => {};
  let clientReceive = (_value: unknown) => {};
  const host = new Endpoint(
    {
      send: (value) => clientReceive(value),
      listen: (receive) => {
        hostReceive = receive;
        return () => {};
      },
    },
    clock,
  );
  const client = new Endpoint(
    {
      send: (value) => hostReceive(value),
      listen: (receive) => {
        clientReceive = receive;
        return () => {};
      },
    },
    clock,
  );
  return {
    host,
    client,
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers]) {
        if (timer.at <= now) {
          timers.delete(timer);
          timer.fire();
        }
      }
    },
  };
}

test("a vault query is not given up after the default RPC deadline", async () => {
  const pair = manualClockPair();
  let finish = (_value: SearchResponse) => {};
  pair.host.handle(
    protocol,
    "query",
    () => new Promise<SearchResponse>((resolve) => (finish = resolve)),
  );
  const updates: SearchUpdate[] = [];
  const client = new QueryClient(pair.client);
  client.watch("meeting", "file:///Note.md", (value) => updates.push(value));
  await tick();
  pair.advance(60_000);
  await tick();
  assert.deepEqual(updates, [{ loading: true }]);
  finish({ results: [{ path: "Slow.md", href: "Slow.md" }], unreadable: 0 });
  await tick();
  assert.deepEqual(updates.at(-1), {
    loading: false,
    results: [{ path: "Slow.md", href: "Slow.md" }],
    unreadable: 0,
  });
  client.dispose();
  await pair.host.dispose();
  await pair.client.dispose();
});

test("a failed query keeps the matches streamed before the failure", async () => {
  const pair = rpcPair();
  let fail = (_error: Error) => {};
  let id: string | undefined;
  pair.host.handle(protocol, "query", (request) => {
    id = request.id;
    return new Promise<SearchResponse>((_resolve, reject) => (fail = reject));
  });
  const updates: SearchUpdate[] = [];
  const client = new QueryClient(pair.client);
  client.watch("meeting", "file:///Note.md", (value) => updates.push(value));
  await tick();
  pair.host.notify(protocol, "partial", {
    id: id!,
    results: [{ path: "A.md", href: "A.md" }],
    unreadable: 0,
  });
  pair.host.notify(protocol, "partial", {
    id: id!,
    results: [{ path: "B.md", href: "B.md" }],
    unreadable: 1,
  });
  await tick();
  fail(new Error("Search evaluation timed out for C.md"));
  await tick();
  const last = updates.at(-1);
  assert.equal(last?.loading, false);
  assert.match(String(last && "error" in last ? last.error : ""), /C\.md/);
  assert.deepEqual(last && "results" in last ? last.results : undefined, [
    { path: "A.md", href: "A.md" },
    { path: "B.md", href: "B.md" },
  ]);
  assert.equal(last && "unreadable" in last ? last.unreadable : 0, 1);
  client.dispose();
  await pair.dispose();
});

test("an index refresh keeps the last results until the new ones arrive", async () => {
  const pair = rpcPair();
  const jobs: {
    id: string | undefined;
    resolve(value: SearchResponse): void;
  }[] = [];
  pair.host.handle(
    protocol,
    "query",
    (request) =>
      new Promise<SearchResponse>((resolve) =>
        jobs.push({ id: request.id, resolve }),
      ),
  );
  const updates: SearchUpdate[] = [];
  const client = new QueryClient(pair.client);
  client.watch("meeting", "file:///Note.md", (value) => updates.push(value));
  await tick();
  jobs[0]!.resolve({
    results: [{ path: "A.md", href: "A.md" }],
    unreadable: 0,
  });
  await tick();
  updates.length = 0;
  client.refresh();
  await tick();
  pair.host.notify(protocol, "partial", {
    id: jobs[1]!.id!,
    results: [{ path: "B.md", href: "B.md" }],
    unreadable: 0,
  });
  await tick();
  // Nothing empties the block or shows half a result meanwhile.
  assert.deepEqual(updates, [{ loading: true, refreshing: true }]);
  jobs[1]!.resolve({
    results: [
      { path: "A.md", href: "A.md" },
      { path: "B.md", href: "B.md" },
    ],
    unreadable: 0,
  });
  await tick();
  assert.deepEqual(updates.at(-1), {
    loading: false,
    results: [
      { path: "A.md", href: "A.md" },
      { path: "B.md", href: "B.md" },
    ],
    unreadable: 0,
  });
  client.dispose();
  await pair.dispose();
});
