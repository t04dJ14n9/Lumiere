import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { serveFile, serveStatic } from "../../src/host/static";

const INSIDE_BODY = "INSIDE_OK";
const OUTSIDE_MARKER = "OUTSIDE_MARKER_729_DO_NOT_SERVE";

async function serving(t: test.TestContext, file: string): Promise<string> {
  const server = createServer((_req, res) => {
    void serveFile(res, file);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

async function servingStatic(t: test.TestContext, base: string): Promise<string> {
  const server = createServer((req, res) => {
    const relative = (req.url ?? "/").replace(/^\//, "").split("?")[0] ?? "";
    void serveStatic(res, base, relative);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

type BundleFixture = {
  bundle: string;
  rootLink: string;
  secret: string;
  missingRoot: string;
  symlinkOk: boolean;
};

async function bundleFixture(t: test.TestContext): Promise<BundleFixture> {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-static-serve-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bundle = path.join(dir, "bundle");
  const outside = path.join(dir, "outside");
  const prefixOutside = path.join(dir, "bundle-outside");
  const secret = path.join(outside, "secret.js");
  const rootLink = path.join(dir, "root-link");
  await mkdir(bundle);
  await mkdir(outside);
  await mkdir(prefixOutside);
  await writeFile(path.join(bundle, "inside.js"), INSIDE_BODY);
  await writeFile(secret, OUTSIDE_MARKER);
  await writeFile(path.join(prefixOutside, "secret.js"), OUTSIDE_MARKER);
  let symlinkOk = true;
  try {
    await symlink("inside.js", path.join(bundle, "alias.js"));
    await symlink(secret, path.join(bundle, "escape.js"));
    await symlink(
      path.join(prefixOutside, "secret.js"),
      path.join(bundle, "prefix.js"),
    );
    await symlink(
      path.join(outside, "missing.js"),
      path.join(bundle, "dangling.js"),
    );
    if (process.platform !== "win32") {
      await symlink(path.parse(dir).root, rootLink);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTSUP" || code === "EPERM") {
      symlinkOk = false;
    } else {
      throw error;
    }
  }
  return {
    bundle,
    rootLink,
    secret,
    missingRoot: path.join(dir, "no-such-root"),
    symlinkOk,
  };
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

test("serveStatic serves a contained file", async (t) => {
  const { bundle } = await bundleFixture(t);
  const response = await fetch(`${await servingStatic(t, bundle)}inside.js`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), INSIDE_BODY);
});

test("serveStatic serves a contained symlink", async (t) => {
  const { bundle, symlinkOk } = await bundleFixture(t);
  if (!symlinkOk) {
    t.skip("creating symlinks is not supported on this platform");
    return;
  }
  const response = await fetch(`${await servingStatic(t, bundle)}alias.js`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), INSIDE_BODY);
});

test("serveStatic refuses a durable outside symlink without leaking bytes", async (t) => {
  const { bundle, symlinkOk } = await bundleFixture(t);
  if (!symlinkOk) {
    t.skip("creating symlinks is not supported on this platform");
    return;
  }
  const response = await fetch(`${await servingStatic(t, bundle)}escape.js`);
  const body = await response.text();
  assert.equal(response.status, 403);
  assert.equal(body.includes(OUTSIDE_MARKER), false);
});

test("serveStatic refuses a symlink into a sibling with the root's prefix", async (t) => {
  const { bundle, symlinkOk } = await bundleFixture(t);
  if (!symlinkOk) {
    t.skip("creating symlinks is not supported on this platform");
    return;
  }
  const response = await fetch(`${await servingStatic(t, bundle)}prefix.js`);
  const body = await response.text();
  assert.equal(response.status, 403);
  assert.equal(body.includes(OUTSIDE_MARKER), false);
});

test("serveStatic refuses a missing path that becomes an outside symlink", async (t) => {
  const { bundle, secret, symlinkOk } = await bundleFixture(t);
  if (!symlinkOk) {
    t.skip("creating symlinks is not supported on this platform");
    return;
  }
  const url = await servingStatic(t, bundle);
  const missing = await fetch(`${url}late.js`);
  assert.equal(missing.status, 404);
  await missing.text();
  await symlink(secret, path.join(bundle, "late.js"));
  const response = await fetch(`${url}late.js`);
  const body = await response.text();
  assert.equal(response.status, 403);
  assert.equal(body.includes(OUTSIDE_MARKER), false);
});

test("serveStatic refuses a root that resolves to the filesystem root", async (t) => {
  if (process.platform === "win32") {
    t.skip("a junction to a drive root needs privileges on Windows");
    return;
  }
  const { rootLink, symlinkOk } = await bundleFixture(t);
  if (!symlinkOk) {
    t.skip("creating symlinks is not supported on this platform");
    return;
  }
  const response = await fetch(`${await servingStatic(t, rootLink)}etc/hosts`);
  const body = await response.text();
  assert.equal(response.status, 403);
  assert.equal(body, "");
});

test("serveStatic returns 404 for a missing contained path", async (t) => {
  const { bundle } = await bundleFixture(t);
  const response = await fetch(`${await servingStatic(t, bundle)}missing.js`);
  assert.equal(response.status, 404);
});

test("serveStatic returns 404 for a dangling symlink", async (t) => {
  const { bundle, symlinkOk } = await bundleFixture(t);
  if (!symlinkOk) {
    t.skip("creating symlinks is not supported on this platform");
    return;
  }
  const response = await fetch(`${await servingStatic(t, bundle)}dangling.js`);
  const body = await response.text();
  assert.equal(response.status, 404);
  assert.equal(body.includes(OUTSIDE_MARKER), false);
});

test("serveStatic returns 403 when the bundle root cannot be resolved", async (t) => {
  const { missingRoot } = await bundleFixture(t);
  const response = await fetch(`${await servingStatic(t, missingRoot)}inside.js`);
  assert.equal(response.status, 403);
});
