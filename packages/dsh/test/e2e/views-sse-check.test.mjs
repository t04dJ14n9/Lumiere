/**
 * Harness-free contract tests for the views snapshot + SSE check.
 * Uses only Node builtins (node:test, node:http, fetch).
 */
/* global setTimeout, TextEncoder, ReadableStream */
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  assertViewsSnapshotAndSse,
  assertViewsSseNegatives,
  maybeAssertIncidentalTreeEvent,
  rawRequest,
  readFirstSseBlock,
} from "./views-sse-check.mjs";

const COOKIE = "e2e=1";
const PREAMBLE = ": lumiere views\n\n";
const WELL_FORMED_EVENT = `data: ${JSON.stringify({ type: "changed", viewId: "lumiere.markdown.outline" })}\n\n`;
const MALFORMED_EVENT = `data: ${JSON.stringify({ type: "nope", viewId: "x" })}\n\n`;

function get(base, cookie = COOKIE) {
  const origin = new URL(base).origin;
  return (url, extra = {}) =>
    fetch(url, { headers: { Cookie: cookie, Origin: origin, ...extra } });
}

function opts(base, extra = {}) {
  return {
    base,
    get: get(base),
    cookie: COOKIE,
    origin: new URL(base).origin,
    timeoutMs: 1000,
    ...extra,
  };
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close() {
      server.closeAllConnections();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  return (req.headers.cookie ?? "").includes(COOKIE);
}

function writeSseHead(res, requestLog) {
  if (requestLog) {
    requestLog.headersWritten = true;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
}

function trackStream(openStreams, res) {
  if (!openStreams) {
    return;
  }
  openStreams.add(res);
  res.on("close", () => openStreams.delete(res));
}

/** Contract-faithful mock: list, snapshot, events preamble, and the negatives. */
function contractHandler({
  views = ["other.view", "lumiere.markdown.outline"],
  snapshots = {
    "lumiere.markdown.outline": {
      viewId: "lumiere.markdown.outline",
      items: [],
      truncated: false,
    },
    "other.view": { viewId: "other.view", items: [], truncated: true },
  },
  hangEvents = false,
  hangEventsNoHeaders = false,
  hangIncompletePreamble = false,
  requestLog = { headersWritten: false, requestClosed: false },
  delayedEventMs,
  streamPutEvents = false,
  streamUnauthEvents = false,
  hangInvalidId = false,
  destroyInvalidId = false,
  requested = { snapshotIds: [] },
  openStreams,
} = {}) {
  return (req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    if (url === "/lumiere/views" && method === "GET") {
      if (!authorized(req)) {
        res.writeHead(401).end();
        return;
      }
      json(res, 200, { views });
      return;
    }
    if (url === "/lumiere/views/events") {
      if (method === "PUT") {
        if (streamPutEvents) {
          trackStream(openStreams, res);
          writeSseHead(res, requestLog);
          res.flushHeaders();
          res.write(PREAMBLE);
          return;
        }
        res.writeHead(405, { Allow: "GET, POST, HEAD" }).end();
        return;
      }
      if (method !== "GET") {
        res.writeHead(404).end();
        return;
      }
      if (!authorized(req)) {
        if (streamUnauthEvents) {
          trackStream(openStreams, res);
          writeSseHead(res, requestLog);
          res.flushHeaders();
          res.write(PREAMBLE);
          return;
        }
        res.writeHead(401).end();
        return;
      }
      trackStream(openStreams, res);
      // A request's `close` means it was read; the unfinished response's
      // premature close is what proves the client aborted a headerless hang.
      res.on("close", () => {
        if (!res.writableFinished) {
          requestLog.requestClosed = true;
        }
      });
      if (hangEventsNoHeaders) {
        // Do not write or flush headers: fetch must wait until abort.
        return;
      }
      if (hangEvents || hangIncompletePreamble) {
        writeSseHead(res, requestLog);
        res.flushHeaders();
        if (hangIncompletePreamble) {
          res.write(": lumiere views");
        }
        return;
      }
      writeSseHead(res, requestLog);
      res.write(PREAMBLE);
      if (delayedEventMs !== undefined) {
        setTimeout(() => {
          try {
            res.write(WELL_FORMED_EVENT);
          } catch {
            // client already closed
          }
        }, delayedEventMs);
      }
      return;
    }
    if (url === "/lumiere/views/%ZZ") {
      if (destroyInvalidId) {
        req.destroy();
        return;
      }
      if (hangInvalidId) {
        return;
      }
      json(res, 400, { error: "Invalid view id" });
      return;
    }
    const snapshotMatch = /^\/lumiere\/views\/([^/]+)$/.exec(url);
    if (snapshotMatch && method === "GET") {
      if (!authorized(req)) {
        res.writeHead(401).end();
        return;
      }
      let viewId;
      try {
        viewId = decodeURIComponent(snapshotMatch[1]);
      } catch {
        json(res, 400, { error: "Invalid view id" });
        return;
      }
      requested.snapshotIds.push(viewId);
      const snapshot = snapshots[viewId];
      if (!snapshot) {
        json(res, 404, { error: "No such view" });
        return;
      }
      json(res, 200, snapshot);
      return;
    }
    res.writeHead(404).end();
  };
}

function streamFromChunks(chunks, { hang = false } = {}) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      }
      if (!hang) {
        controller.close();
      }
    },
  });
}

/** Frozen copy of the previous false-pass check (dsh-e2e.mjs at 86de84a2). */
async function legacyAssertViewsSnapshotAndSse({
  base,
  get,
  cookie,
  origin,
  timeoutMs = 3000,
}) {
  const views = await (await get(`${base}/lumiere/views`)).json();
  assert(Array.isArray(views.views), "no view ids");
  if (views.views.length > 0) {
    const snapshot = await get(
      `${base}/lumiere/views/${encodeURIComponent(views.views[0])}`,
    );
    assert(snapshot.status === 200, `snapshot -> ${snapshot.status}`);
  }
  const stream = await fetch(`${base}/lumiere/views/events`, {
    headers: { Cookie: cookie, Origin: origin },
    signal: globalThis.AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined);
  if (stream) {
    assert(stream.status === 200, `events -> ${stream.status}`);
    assert(
      (stream.headers.get("content-type") ?? "").includes("text/event-stream"),
      "not an SSE stream",
    );
    await stream.body?.cancel().catch(() => undefined);
  }
  return "views list, snapshot and SSE ok";
}

async function expectReject(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error), pattern);
    return true;
  });
}

async function assertClosed(openStreams) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(openStreams.size, 0, "SSE stream was left open");
}

test("legacy check false-passes on an empty views list", async (t) => {
  const { close, base } = await listen(contractHandler({ views: [] }));
  t.after(() => close());
  const detail = await legacyAssertViewsSnapshotAndSse(opts(base));
  assert.equal(detail, "views list, snapshot and SSE ok");
});

test("legacy check swallows an SSE fetch timeout when no response headers arrive", async (t) => {
  const requestLog = { headersWritten: false, requestClosed: false };
  const { close, base } = await listen(
    contractHandler({ hangEventsNoHeaders: true, requestLog }),
  );
  t.after(() => close());
  const detail = await legacyAssertViewsSnapshotAndSse({
    ...opts(base),
    timeoutMs: 150,
  });
  assert.equal(detail, "views list, snapshot and SSE ok");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    requestLog.headersWritten,
    false,
    "legacy fetch received headers, so the timeout path was not taken",
  );
  assert.equal(
    requestLog.requestClosed,
    true,
    "client did not abort the headerless hang; swallowed-timeout path unproven",
  );
});

test("empty views list fails the check", async (t) => {
  const { close, base } = await listen(contractHandler({ views: [] }));
  t.after(() => close());
  await expectReject(
    assertViewsSnapshotAndSse(opts(base)),
    /non-empty|no view/i,
  );
});

test("SSE timeout or abort fails the check and drops the stream", async (t) => {
  const openStreams = new Set();
  const { close, base } = await listen(
    contractHandler({ hangEvents: true, openStreams }),
  );
  t.after(() => close());
  await expectReject(
    assertViewsSnapshotAndSse({ ...opts(base), timeoutMs: 150 }),
    /abort|timeout|aborted/i,
  );
  await assertClosed(openStreams);
});

test("header-flushed incomplete preamble times out during body read and drops the stream", async (t) => {
  const openStreams = new Set();
  const { close, base } = await listen(
    contractHandler({ hangIncompletePreamble: true, openStreams }),
  );
  t.after(() => close());
  await expectReject(
    assertViewsSnapshotAndSse({ ...opts(base), timeoutMs: 150 }),
    /abort|timeout|aborted/i,
  );
  await assertClosed(openStreams);
});

test("happy path requires snapshot of preferred id, preamble, and stream cleanup", async (t) => {
  const openStreams = new Set();
  const requested = { snapshotIds: [] };
  const { close, base } = await listen(
    contractHandler({ openStreams, requested }),
  );
  t.after(() => close());
  const detail = await assertViewsSnapshotAndSse(opts(base));
  assert.match(String(detail), /ok/i);
  assert.deepEqual(requested.snapshotIds, ["lumiere.markdown.outline"]);
  await assertClosed(openStreams);
});

test("snapshot is the first listed id when the preferred id is absent", async (t) => {
  const requested = { snapshotIds: [] };
  const { close, base } = await listen(
    contractHandler({
      views: ["custom.view"],
      snapshots: {
        "custom.view": { viewId: "custom.view", items: [], truncated: false },
      },
      requested,
    }),
  );
  t.after(() => close());
  await assertViewsSnapshotAndSse(opts(base));
  assert.deepEqual(requested.snapshotIds, ["custom.view"]);
});

test("snapshot missing viewId/items/truncated shape fails the check", async (t) => {
  const { close, base } = await listen(
    contractHandler({
      views: ["custom.view"],
      snapshots: { "custom.view": { viewId: "custom.view", items: [] } },
    }),
  );
  t.after(() => close());
  await expectReject(
    assertViewsSnapshotAndSse(opts(base)),
    /truncated|snapshot/i,
  );
});

test("a later TreeEvent is not awaited after the preamble", async (t) => {
  const { close, base } = await listen(
    contractHandler({ delayedEventMs: 400 }),
  );
  t.after(() => close());
  const started = Date.now();
  await assertViewsSnapshotAndSse(opts(base));
  assert.ok(Date.now() - started < 400, "check waited for a later TreeEvent");
});

test("readFirstSseBlock reassembles a preamble split across chunks", async () => {
  const { block, rest } = await readFirstSseBlock(
    streamFromChunks([": lumiere views", "\n\n"]),
  );
  assert.equal(block, PREAMBLE);
  assert.equal(rest, "");
});

test("readFirstSseBlock reassembles a preamble split on the delimiter", async () => {
  const { block, rest } = await readFirstSseBlock(
    streamFromChunks([": lumiere views\n", "\nmore"]),
  );
  assert.equal(block, PREAMBLE);
  assert.equal(rest, "more");
});

test("a complete well-formed leftover event is accepted", () => {
  maybeAssertIncidentalTreeEvent(WELL_FORMED_EVENT);
});

test("a complete malformed leftover event is rejected", () => {
  assert.throws(
    () => maybeAssertIncidentalTreeEvent(MALFORMED_EVENT),
    /TreeEvent|type/i,
  );
});

test("an incomplete leftover event in the same read is ignored", async () => {
  const { block, rest } = await readFirstSseBlock(
    streamFromChunks([`${PREAMBLE}data: {"type":"changed"`]),
  );
  assert.equal(block, PREAMBLE);
  assert.equal(rest, 'data: {"type":"changed"');
  maybeAssertIncidentalTreeEvent(rest);
});

test("a stream that ends before a complete preamble fails", async () => {
  await expectReject(
    readFirstSseBlock(streamFromChunks([": lumiere views"])),
    /complete event block/i,
  );
});

test("a leftover malformed event after a split preamble is rejected", async () => {
  const { block, rest } = await readFirstSseBlock(
    streamFromChunks([": lumiere views\n", `\n${MALFORMED_EVENT}`]),
  );
  assert.equal(block, PREAMBLE);
  assert.throws(() => maybeAssertIncidentalTreeEvent(rest), /TreeEvent|type/i);
});

test("negatives: unknown view 404, invalid id 400, PUT events 405, unauthenticated 401 or 403", async (t) => {
  const { close, base } = await listen(contractHandler());
  t.after(() => close());
  const detail = await assertViewsSseNegatives(opts(base));
  assert.match(String(detail), /404|400|405|401|403/i);
});

test("unexpected PUT SSE stream fails the negative and drops the stream", async (t) => {
  const openStreams = new Set();
  const { close, base } = await listen(
    contractHandler({ streamPutEvents: true, openStreams }),
  );
  t.after(() => close());
  await expectReject(
    assertViewsSseNegatives({ ...opts(base), timeoutMs: 150 }),
    /PUT events -> 200/,
  );
  await assertClosed(openStreams);
});

test("unexpected unauthenticated SSE stream fails the negative and drops the stream", async (t) => {
  const openStreams = new Set();
  const { close, base } = await listen(
    contractHandler({ streamUnauthEvents: true, openStreams }),
  );
  t.after(() => close());
  await expectReject(
    assertViewsSseNegatives({ ...opts(base), timeoutMs: 150 }),
    /unauthenticated events -> 200/,
  );
  await assertClosed(openStreams);
});

test("raw invalid-id hang times out, aborts, and does not leave the request open", async (t) => {
  const { close, base } = await listen(
    contractHandler({ hangInvalidId: true }),
  );
  t.after(() => close());
  const started = Date.now();
  await expectReject(
    rawRequest(base, {
      path: "/lumiere/views/%ZZ",
      headers: { Cookie: COOKIE, Origin: new URL(base).origin },
      timeoutMs: 150,
    }),
    /abort|timeout|aborted/i,
  );
  assert.ok(Date.now() - started < 1000, "raw request did not honor timeoutMs");
});

test("raw invalid-id connection destroy is reported as an error", async (t) => {
  const { close, base } = await listen(
    contractHandler({ destroyInvalidId: true }),
  );
  t.after(() => close());
  await assert.rejects(
    rawRequest(base, {
      path: "/lumiere/views/%ZZ",
      headers: { Cookie: COOKIE, Origin: new URL(base).origin },
      timeoutMs: 500,
    }),
  );
});
