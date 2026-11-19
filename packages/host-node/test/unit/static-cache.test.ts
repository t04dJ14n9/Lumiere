import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { matchesTag, serveStatic } from "../../src/host/static";

async function bundle(t: test.TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-static-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "webview.js"), "console.log('entry')");
  await writeFile(path.join(dir, "chunk-5XQ2ZK7A.js"), "export {}");
  const server = createServer((req, res) => {
    void serveStatic(res, dir, (req.url ?? "/").slice(1), req.headers);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = (server.address() as AddressInfo).port;
  return { dir, base: `http://127.0.0.1:${port}` };
}

test("an editor file sent again is revalidated with its tag and answered 304", async (t) => {
  const { base } = await bundle(t);
  const first = await fetch(`${base}/webview.js`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-cache");
  const tag = first.headers.get("etag");
  assert.ok(tag);
  await first.text();

  const again = await fetch(`${base}/webview.js`, {
    headers: { "if-none-match": tag },
  });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get("etag"), tag);
  assert.equal(await again.text(), "");
});

test("a changed file gets a new tag and its new bytes", async (t) => {
  const { dir, base } = await bundle(t);
  const first = await fetch(`${base}/webview.js`);
  const tag = first.headers.get("etag")!;
  await first.text();
  const file = path.join(dir, "webview.js");
  await writeFile(file, "console.log('a new build')");
  const later = new Date(Date.now() + 5_000);
  await utimes(file, later, later);

  const again = await fetch(`${base}/webview.js`, {
    headers: { "if-none-match": tag },
  });
  assert.equal(again.status, 200);
  assert.notEqual(again.headers.get("etag"), tag);
  assert.equal(await again.text(), "console.log('a new build')");
});

test("a content-hashed chunk is cached for good", async (t) => {
  const { base } = await bundle(t);
  const chunk = await fetch(`${base}/chunk-5XQ2ZK7A.js`);
  assert.equal(chunk.status, 200);
  assert.match(chunk.headers.get("cache-control") ?? "", /immutable/);
  await chunk.text();
});

test("If-None-Match compares tags weakly and accepts a list or *", () => {
  assert.equal(matchesTag('W/"a-1"', 'W/"a-1"'), true);
  assert.equal(matchesTag('"a-1"', 'W/"a-1"'), true);
  assert.equal(matchesTag('"x", W/"a-1"', 'W/"a-1"'), true);
  assert.equal(matchesTag("*", 'W/"a-1"'), true);
  assert.equal(matchesTag('W/"a-2"', 'W/"a-1"'), false);
  assert.equal(matchesTag(undefined, 'W/"a-1"'), false);
});
