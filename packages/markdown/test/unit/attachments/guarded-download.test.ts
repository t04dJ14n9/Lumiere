import test from "node:test";
import assert from "node:assert/strict";
import {
  loadAttachmentOutcome,
  type SourceFetch,
  type SourceOptions,
} from "../../../src/attachments/source";

interface Reply {
  status?: number;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  bytes?: number[];
  /** Chunks of a streamed body, which the test can watch being read. */
  chunks?: number[][];
}

interface Call {
  url: string;
  redirect: string | undefined;
  signal: AbortSignal | undefined;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];

/** A fetch answering from `replies` by URL, remembering how it was asked. */
function network(replies: Record<string, Reply>) {
  const calls: Call[] = [];
  const watched = { read: 0, cancelled: false, arrayBuffer: 0 };
  const fetch: SourceFetch = async (url, init) => {
    calls.push({ url, redirect: init?.redirect, signal: init?.signal });
    const reply = replies[url] ?? { status: 404 };
    const status = reply.status ?? 200;
    const headers = { "content-type": "image/png", ...reply.headers };
    const chunks = reply.chunks;
    return {
      ok: status >= 200 && status < 300,
      status,
      ...(reply.type === undefined ? {} : { type: reply.type }),
      ...(reply.url === undefined ? {} : { url: reply.url }),
      headers: {
        get: (name: string) =>
          (headers as Record<string, string>)[name.toLowerCase()] ?? null,
      },
      ...(chunks
        ? {
            body: {
              getReader: () => {
                let next = 0;
                return {
                  read: async () => {
                    watched.read++;
                    return next < chunks.length
                      ? { done: false, value: Uint8Array.from(chunks[next++]!) }
                      : { done: true, value: undefined };
                  },
                  cancel: async () => {
                    watched.cancelled = true;
                  },
                };
              },
            },
          }
        : {}),
      arrayBuffer: async () => {
        watched.arrayBuffer++;
        return Uint8Array.from(reply.bytes ?? PNG).buffer;
      },
    };
  };
  return { fetch, calls, watched };
}

const load = (
  url: string,
  fetch: SourceFetch,
  limits?: SourceOptions["limits"],
) =>
  loadAttachmentOutcome(url, {
    imagesOnly: true,
    fetch,
    readFile: async () => undefined,
    ...(limits ? { limits } : {}),
  });

const FAILED = { kind: "failed" };

test("a private address is never requested", async () => {
  for (const url of [
    "http://127.0.0.1:8080/admin.png",
    "http://localhost/a.png",
    "http://169.254.169.254/latest/meta-data/x.png",
    "http://[::1]/a.png",
    "http://192.168.0.1/a.png",
  ]) {
    const net = network({ [url]: {} });
    assert.deepEqual(await load(url, net.fetch), FAILED, url);
    assert.deepEqual(net.calls, [], url);
  }
});

test("redirects are followed one hop at a time, relative or absolute", async () => {
  const net = network({
    "https://a.com/start.png": {
      status: 302,
      headers: { location: "/mid.png" },
    },
    "https://a.com/mid.png": {
      status: 301,
      headers: { location: "https://cdn.b.com/final.png" },
    },
    "https://cdn.b.com/final.png": {},
  });
  const outcome = await load("https://a.com/start.png", net.fetch);
  assert.equal(outcome.kind, "loaded");
  assert.deepEqual(
    net.calls.map((call) => [call.url, call.redirect]),
    [
      ["https://a.com/start.png", "manual"],
      ["https://a.com/mid.png", "manual"],
      ["https://cdn.b.com/final.png", "manual"],
    ],
  );
  assert.ok(net.calls.every((call) => call.signal instanceof AbortSignal));
});

test("a redirect to a private address is refused and not requested", async () => {
  for (const target of [
    "http://127.0.0.1/secret.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/a.png",
    "//localhost/a.png",
    "http://[::ffff:7f00:1]/a.png",
  ]) {
    const net = network({
      "https://a.com/x.png": { status: 307, headers: { location: target } },
      [target]: {},
    });
    assert.deepEqual(
      await load("https://a.com/x.png", net.fetch),
      FAILED,
      target,
    );
    assert.deepEqual(
      net.calls.map((call) => call.url),
      ["https://a.com/x.png"],
      target,
    );
  }
});

test("a redirect to another scheme is refused", async () => {
  for (const target of [
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    "ftp://a.com/x.png",
    "javascript:alert(1)",
  ]) {
    const net = network({
      "https://a.com/x.png": { status: 302, headers: { location: target } },
    });
    assert.deepEqual(
      await load("https://a.com/x.png", net.fetch),
      FAILED,
      target,
    );
    assert.equal(net.calls.length, 1, target);
  }
});

test("at most five redirects are followed", async () => {
  const chain = (hops: number) => {
    const replies: Record<string, Reply> = {};
    for (let hop = 0; hop < hops; hop++) {
      replies[`https://a.com/${hop}.png`] = {
        status: 302,
        headers: { location: `/${hop + 1}.png` },
      };
    }
    replies[`https://a.com/${hops}.png`] = {};
    return network(replies);
  };
  const five = chain(5);
  assert.equal((await load("https://a.com/0.png", five.fetch)).kind, "loaded");
  const six = chain(6);
  assert.deepEqual(await load("https://a.com/0.png", six.fetch), FAILED);
  assert.equal(six.calls.length, 6, "the sixth redirect is not followed");
});

test("a redirect with no Location is the answer, and is no image", async () => {
  const net = network({ "https://a.com/x.png": { status: 304 } });
  assert.deepEqual(await load("https://a.com/x.png", net.fetch), FAILED);
  assert.equal(net.calls.length, 1);
});

test("where a browser hides the redirect, the URL is fetched again as the browser follows it", async () => {
  const calls: (string | undefined)[] = [];
  const answer = (url: string, redirect: string | undefined) => ({
    ok: redirect === "follow",
    type: redirect === "follow" ? "basic" : "opaqueredirect",
    status: redirect === "follow" ? 200 : 0,
    url,
    headers: {
      get: (name: string) => (name === "content-type" ? "image/png" : null),
    },
    arrayBuffer: async () => Uint8Array.from(PNG).buffer,
  });
  const followed: SourceFetch = async (url, init) => {
    calls.push(init?.redirect);
    return answer(url, init?.redirect);
  };
  assert.equal((await load("https://a.com/x.png", followed)).kind, "loaded");
  assert.deepEqual(calls, ["manual", "follow"]);

  const landed: SourceFetch = async (_url, init) =>
    answer(
      init?.redirect === "follow"
        ? "http://127.0.0.1/a.png"
        : "https://a.com/x.png",
      init?.redirect,
    );
  assert.deepEqual(await load("https://a.com/x.png", landed), FAILED);
});

test("a download that takes too long is given up, and the request is aborted", async () => {
  let signal: AbortSignal | undefined;
  const hanging: SourceFetch = (_url, init) => {
    signal = init?.signal;
    return new Promise(() => {});
  };
  assert.deepEqual(
    await load("https://a.com/x.png", hanging, { timeoutMs: 20 }),
    FAILED,
  );
  assert.equal(signal?.aborted, true);
});

test("a body that stalls counts against the same time", async () => {
  const stalled: SourceFetch = async () => ({
    ok: true,
    headers: {
      get: (name: string) => (name === "content-type" ? "image/png" : null),
    },
    body: {
      getReader: () => ({
        read: () =>
          new Promise<{ done: boolean; value?: Uint8Array }>(() => {}),
        cancel: async () => {},
      }),
    },
    arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
  });
  assert.deepEqual(
    await load("https://a.com/x.png", stalled, { timeoutMs: 20 }),
    FAILED,
  );
});

test("the timer is cleared when the download finishes", async () => {
  const net = network({ "https://a.com/x.png": {} });
  const started = Date.now();
  assert.equal(
    (await load("https://a.com/x.png", net.fetch, { timeoutMs: 60_000 })).kind,
    "loaded",
  );
  assert.ok(Date.now() - started < 1000);
});

test("a body larger than the cap is refused, by its declared length before it is read", async () => {
  const net = network({
    "https://a.com/x.png": {
      headers: { "content-length": "11" },
      chunks: [[1]],
    },
  });
  assert.deepEqual(
    await load("https://a.com/x.png", net.fetch, { maxBytes: 10 }),
    FAILED,
  );
  assert.equal(net.watched.read, 0, "the body is never read");
  assert.equal(net.watched.arrayBuffer, 0);
});

test("a stream that outgrows the cap is cancelled where it crosses it", async () => {
  const net = network({
    "https://a.com/x.png": {
      chunks: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11], [12]],
    },
  });
  assert.deepEqual(
    await load("https://a.com/x.png", net.fetch, { maxBytes: 10 }),
    FAILED,
  );
  assert.equal(net.watched.cancelled, true);
  assert.equal(net.watched.read, 3, "the last chunk is not read");
});

test("a body with no stream is counted after it is read", async () => {
  const net = network({ "https://a.com/x.png": { bytes: Array(11).fill(1) } });
  assert.deepEqual(
    await load("https://a.com/x.png", net.fetch, { maxBytes: 10 }),
    FAILED,
  );
});

test("a body of exactly the cap is kept, streamed or not", async () => {
  const streamed = network({
    "https://a.com/x.png": {
      chunks: [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
      ],
    },
  });
  const outcome = await load("https://a.com/x.png", streamed.fetch, {
    maxBytes: 10,
  });
  assert.equal(outcome.kind === "loaded" && outcome.source.bytes.length, 10);
  assert.deepEqual(
    outcome.kind === "loaded" && [...outcome.source.bytes],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  const whole = network({
    "https://a.com/x.png": { bytes: Array(10).fill(1) },
  });
  assert.equal(
    (await load("https://a.com/x.png", whole.fetch, { maxBytes: 10 })).kind,
    "loaded",
  );
});

test("the defaults are 30 seconds, 50 MB and five redirects", async () => {
  const { DOWNLOAD_LIMITS } =
    await import("../../../src/attachments/guarded-download");
  assert.deepEqual(DOWNLOAD_LIMITS, {
    timeoutMs: 30_000,
    maxBytes: 50 * 1024 * 1024,
    maxRedirects: 5,
  });
});

test("a local file over the cap is refused too", async () => {
  const outcome = await loadAttachmentOutcome("file:///work/big.png", {
    imagesOnly: true,
    fetch: async () => {
      throw new Error("no network for file");
    },
    readFile: async () => new Uint8Array(11),
    limits: { maxBytes: 10 },
  });
  assert.deepEqual(outcome, FAILED);
});
