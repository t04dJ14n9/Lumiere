import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { serveFile } from "../../src/host/static";

async function serving(t: test.TestContext, file: string): Promise<string> {
  const server = createServer((_req, res) => {
    void serveFile(res, file);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

test("a file is served whole with its content type", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-static-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "pic.png");
  await writeFile(file, "not really a png");
  const response = await fetch(await serving(t, file));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(await response.text(), "not really a png");
});

test("a file that cannot be opened is a 404, not a server crash", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("permissions do not stop this user from reading the file");
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-static-"));
  const file = path.join(dir, "locked.png");
  await writeFile(file, "secret");
  await chmod(file, 0o000);
  t.after(async () => {
    await chmod(file, 0o600);
    await rm(dir, { recursive: true, force: true });
  });
  const url = await serving(t, file);
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url)).status, 404, "the server is still up");
});
