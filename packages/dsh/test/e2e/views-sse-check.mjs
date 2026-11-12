/**
 * Fail-closed views list + snapshot + SSE preamble checks for dsh-e2e.mjs.
 * Extracted so a harness-free node:test can prove the contract.
 */
import http from "node:http";

const TREE_EVENT_TYPES = new Set([
  "changed",
  "reveal",
  "deselect",
  "expand",
  "collapse",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cancelBody(body) {
  try {
    await body?.cancel();
  } catch {
    // Ignore only cancel errors so cleanup cannot hide the original failure.
  }
}

/** Read until the first complete SSE block (`\n\n`). Exported for deterministic fixtures. */
export async function readFirstSseBlock(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error("SSE stream ended before a complete event block");
      }
      buf += decoder.decode(value, { stream: true });
      const end = buf.indexOf("\n\n");
      if (end !== -1) {
        return { block: buf.slice(0, end + 2), rest: buf.slice(end + 2) };
      }
    }
  } finally {
    // Release the reader so the caller's body.cancel() can close the socket.
    try {
      reader.releaseLock();
    } catch {
      // Already released or cancelled.
    }
  }
}

/** Validate a complete leftover `data:` block only; incomplete leftovers are ignored. */
export function maybeAssertIncidentalTreeEvent(rest) {
  const end = rest.indexOf("\n\n");
  if (end === -1) {
    return;
  }
  const line = rest.slice(0, end).trim();
  if (!line.startsWith("data:")) {
    return;
  }
  const payload = line.slice("data:".length).trim();
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    throw new Error(`incidental TreeEvent is not JSON: ${payload}`);
  }
  assert(
    TREE_EVENT_TYPES.has(event.type) && typeof event.viewId === "string",
    `unexpected TreeEvent type: ${payload}`,
  );
}

function abortError(signal, fallback) {
  return signal?.reason instanceof Error ? signal.reason : new Error(fallback);
}

/**
 * Send a path that fetch/WHATWG URL would reject (e.g. `%ZZ`).
 * Honors timeoutMs/signal, destroys the socket on abort, and rejects on
 * response error or abort so a hanging or truncated body cannot stall.
 */
export function rawRequest(
  base,
  { method = "GET", path, headers = {}, signal, timeoutMs },
) {
  const url = new URL(base);
  const timeoutSignal =
    timeoutMs === undefined
      ? undefined
      : globalThis.AbortSignal.timeout(timeoutMs);
  const signals = [signal, timeoutSignal].filter(Boolean);
  const combined =
    signals.length === 0
      ? undefined
      : signals.length === 1
        ? signals[0]
        : globalThis.AbortSignal.any(signals);

  return new Promise((resolve, reject) => {
    let settled = false;
    let resRef;
    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      combined?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const fail = (error) => {
      try {
        req.destroy();
      } catch {
        // already closed
      }
      try {
        resRef?.destroy();
      } catch {
        // already closed
      }
      finish(reject, error);
    };
    const onAbort = () => fail(abortError(combined, "raw request aborted"));

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method,
        headers,
      },
      (res) => {
        resRef = res;
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", (error) => fail(error));
        res.on("aborted", () =>
          fail(new Error("raw request response aborted")),
        );
        res.on("end", () => {
          finish(resolve, {
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", (error) => fail(error));
    if (combined) {
      if (combined.aborted) {
        onAbort();
        return;
      }
      combined.addEventListener("abort", onAbort, { once: true });
    }
    req.end();
  });
}

/**
 * Authenticated views list, one snapshot, and the events preamble.
 * Timeout, abort, an empty views list, or a missing/invalid snapshot fail.
 */
export async function assertViewsSnapshotAndSse({
  base,
  get,
  cookie,
  origin,
  timeoutMs = 3000,
}) {
  const list = await get(`${base}/lumiere/views`);
  assert(list.status === 200, `views list -> ${list.status}`);
  assert(
    (list.headers.get("content-type") ?? "").includes("application/json"),
    "views list is not JSON",
  );
  const views = await list.json();
  assert(
    Array.isArray(views.views) &&
      views.views.length > 0 &&
      views.views.every((id) => typeof id === "string"),
    "expected a non-empty views list of string ids",
  );
  const id = views.views.includes("lumiere.markdown.outline")
    ? "lumiere.markdown.outline"
    : views.views[0];

  const snapshot = await get(`${base}/lumiere/views/${encodeURIComponent(id)}`);
  assert(snapshot.status === 200, `snapshot -> ${snapshot.status}`);
  assert(
    (snapshot.headers.get("content-type") ?? "").includes("application/json"),
    "snapshot is not JSON",
  );
  const body = await snapshot.json();
  assert(
    body.viewId === id &&
      Array.isArray(body.items) &&
      typeof body.truncated === "boolean",
    `snapshot shape invalid: viewId=${String(body.viewId)} truncated=${typeof body.truncated}`,
  );

  let stream;
  try {
    stream = await fetch(`${base}/lumiere/views/events`, {
      headers: { Cookie: cookie, Origin: origin },
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    });
    assert(stream.status === 200, `events -> ${stream.status}`);
    assert(
      (stream.headers.get("content-type") ?? "").includes("text/event-stream"),
      "not an SSE stream",
    );
    assert(
      (stream.headers.get("cache-control") ?? "").includes("no-store"),
      "events missing cache-control: no-store",
    );
    if (!stream.body) {
      throw new Error("events response has no body");
    }
    const { block, rest } = await readFirstSseBlock(stream.body);
    assert(
      block === ": lumiere views\n\n",
      `expected SSE preamble ": lumiere views", got ${JSON.stringify(block)}`,
    );
    maybeAssertIncidentalTreeEvent(rest);
    return "views list, snapshot and SSE ok";
  } finally {
    await cancelBody(stream?.body);
  }
}

/**
 * Source-backed negatives for the views snapshot and events routes.
 * `%ZZ` is sent with node:http because fetch rejects that path as an invalid URL.
 * Events fetches and the raw request are bounded and cleaned up, including when
 * an unexpected stream or hang is what the check is rejecting.
 */
export async function assertViewsSseNegatives({
  base,
  get,
  cookie,
  origin,
  timeoutMs = 3000,
}) {
  const unknown = await get(`${base}/lumiere/views/unknown.view`);
  assert(unknown.status === 404, `unknown view -> ${unknown.status}`);
  const unknownBody = await unknown.json();
  assert(
    unknownBody.error === "No such view",
    `unknown view body: ${JSON.stringify(unknownBody)}`,
  );

  const invalid = await rawRequest(base, {
    path: "/lumiere/views/%ZZ",
    headers: { Cookie: cookie, Origin: origin },
    timeoutMs,
  });
  assert(invalid.status === 400, `invalid view id -> ${invalid.status}`);
  let invalidBody;
  try {
    invalidBody = JSON.parse(invalid.body);
  } catch {
    throw new Error(`invalid view id body is not JSON: ${invalid.body}`);
  }
  assert(
    invalidBody.error === "Invalid view id",
    `invalid view id body: ${invalid.body}`,
  );

  let put;
  try {
    put = await fetch(`${base}/lumiere/views/events`, {
      method: "PUT",
      headers: { Cookie: cookie, Origin: origin },
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    });
    assert(put.status === 405, `PUT events -> ${put.status}`);
    assert(
      put.headers.get("allow") === "GET, POST, HEAD",
      `PUT events Allow: ${put.headers.get("allow")}`,
    );
  } finally {
    await cancelBody(put?.body);
  }

  let unauth;
  try {
    unauth = await fetch(`${base}/lumiere/views/events`, {
      headers: { Origin: origin },
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    });
    assert(
      unauth.status === 401 || unauth.status === 403,
      `unauthenticated events -> ${unauth.status}`,
    );
  } finally {
    await cancelBody(unauth?.body);
  }

  return `unknown 404, invalid 400, PUT 405, unauthenticated ${unauth.status}`;
}
