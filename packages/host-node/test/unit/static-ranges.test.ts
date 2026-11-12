// A file a note shows, or a built editor asset: one byte range or all of it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { byteRange, serveFile, serveStatic } from "../../src/host/static";

const BODY = "0123456789";

test("a byte range names the exact slice of the file", () => {
  assert.deepEqual(byteRange("bytes=0-2", 10), { start: 0, end: 2 });
  assert.deepEqual(byteRange("bytes=4-", 10), { start: 4, end: 9 });
  assert.deepEqual(byteRange("bytes=4-100", 10), { start: 4, end: 9 });
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange("bytes=-100", 10), { start: 0, end: 9 });
});

test("large decimal numerals are clamped, not rejected", () => {
  assert.deepEqual(byteRange("bytes=-999999999999999999999999", 10), {
    start: 0,
    end: 9,
  });
  assert.deepEqual(byteRange("bytes=0-999999999999999999999999", 10), {
    start: 0,
    end: 9,
  });
  assert.equal(
    byteRange("bytes=999999999999999999999999-", 10),
    "unsatisfiable",
  );
});

test("a range past the end, backwards, or of zero bytes cannot be met", () => {
  for (const header of ["bytes=10-", "bytes=9-2", "bytes=-0"]) {
    assert.equal(byteRange(header, 10), "unsatisfiable", header);
  }
  assert.equal(byteRange("bytes=0-2", 0), "unsatisfiable");
});

test("no range, several, an unknown unit, or a bad header means the whole file", () => {
  for (const header of [
    "",
    "bytes=-",
    "bytes=abc-2",
    "items=0-2",
    "bytes=0-2, 4-6",
  ]) {
    assert.equal(byteRange(header, 10), undefined, header);
  }
});

async function file(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-ranges-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const name = path.join(dir, "clip.mp4");
  await writeFile(name, BODY);
  return name;
}

async function serving(t: test.TestContext, name: string): Promise<string> {
  const server = createServer((req, res) => {
    void serveFile(res, name, req.headers.range);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

test("a byte range is 206 with the exact bytes and headers", async (t) => {
  const url = await serving(t, await file(t));
  const response = await fetch(url, { headers: { range: "bytes=2-4" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await response.text(), "234");
});

test("a whole file is 200 and advertises byte ranges", async (t) => {
  const url = await serving(t, await file(t));
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await response.text(), BODY);
});

test("an unsatisfiable range is 416 with the file's length", async (t) => {
  const url = await serving(t, await file(t));
  const response = await fetch(url, { headers: { range: "bytes=99-" } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */10");
  assert.equal(await response.text(), "");
  const whole = await fetch(url);
  assert.equal(whole.status, 200, "the server is still up");
  await whole.text();
});

test("a malformed, multiple or unknown-unit range is ignored", async (t) => {
  const url = await serving(t, await file(t));
  for (const header of [
    "items=0-2",
    "bytes=abc-2",
    "bytes=0-2, 4-6",
    "bytes=-",
  ]) {
    const response = await fetch(url, { headers: { range: header } });
    assert.equal(response.status, 200, header);
    assert.equal(response.headers.get("content-length"), "10");
    assert.equal(await response.text(), BODY, header);
  }
});

test("HEAD sends the same headers without a body", async (t) => {
  const url = await serving(t, await file(t));
  const whole = await fetch(url, { method: "HEAD" });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("content-length"), "10");
  assert.equal(await whole.text(), "");
  const part = await fetch(url, {
    method: "HEAD",
    headers: { range: "bytes=2-4" },
  });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(part.headers.get("content-length"), "3");
  assert.equal(await part.text(), "");
});

test("a static bundle file honours a range and still refuses a symlink out", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-bundle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "assets");
  await mkdir(root);
  await writeFile(path.join(root, "editor.js"), BODY);
  const outside = path.join(dir, "secret.js");
  await writeFile(outside, "secret");
  await symlink(outside, path.join(root, "escape.js"));
  const server = createServer((req, res) => {
    void serveStatic(res, root, req.url?.slice(1) ?? "", req.headers.range);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const part = await fetch(`${base}editor.js`, {
    headers: { range: "bytes=2-4" },
  });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await part.text(), "234");
  const escaped = await fetch(`${base}escape.js`, {
    headers: { range: "bytes=0-2" },
  });
  assert.equal(escaped.status, 403);
  await escaped.text();
});
