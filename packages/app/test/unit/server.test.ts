// The server as the desktop app sees it: start, the token's first request,
// what a page without the token gets, the API, and stopping. The editor's
// pages need the built editor and are covered by the browser tests.
import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { startServer, type RunningServer } from "../../src/server/server";
import { TOKEN_COOKIE } from "../../src/server/auth";
import { SHELL_KEY_HEADER, SHELL_KEY_META } from "../../src/shared/shell-key";

const TOKEN = "test-token-0123456789";
const quiet = { debug() {}, warn() {}, error() {} };

interface Reply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/** A raw request, so the Host and Origin headers are ours to set. */
function send(
  port: number,
  pathname: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: options.method ?? "GET",
        headers: {
          host: `127.0.0.1:${port}`,
          ...(options.body !== undefined
            ? { "content-length": String(Buffer.byteLength(options.body)) }
            : {}),
          ...options.headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

async function fixture(t: test.TestContext): Promise<{
  server: RunningServer;
  dir: string;
  vault: string;
  cookie: string;
}> {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-server-")),
  );
  const assets = path.join(dir, "assets");
  const vault = path.join(dir, "vault");
  await mkdir(path.join(assets, "shell"), { recursive: true });
  await mkdir(path.join(assets, "markdown"), { recursive: true });
  await mkdir(path.join(vault, "daily"), { recursive: true });
  await writeFile(
    path.join(assets, "shell", "index.html"),
    `<!doctype html><meta name="${SHELL_KEY_META}" content="" /><title>Lumière</title>`,
  );
  await writeFile(path.join(dir, "secret.txt"), "not for pages");
  await writeFile(path.join(vault, "daily", "today.md"), "# Today");
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    data: path.join(dir, "data"),
    assets,
    vaults: [vault],
    version: "0.0.0-test",
    logger: quiet,
  });
  t.after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { server, dir, vault, cookie: `${TOKEN_COOKIE}=${TOKEN}` };
}

test("the launch URL logs the window in once, then the cookie carries it", async (t) => {
  const { server } = await fixture(t);
  assert.equal(server.url, `http://127.0.0.1:${server.port}/?token=${TOKEN}`);
  const first = await send(
    server.port,
    new URL(server.url).pathname + new URL(server.url).search,
  );
  assert.equal(first.status, 303);
  assert.equal(first.headers.location, "/");
  const cookie = String(first.headers["set-cookie"]).split(";")[0] ?? "";
  const page = await send(server.port, "/", { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>Lumière<\/title>/);
});

test("without the token, from another site or by another name, nothing is served", async (t) => {
  const { server, cookie } = await fixture(t);
  assert.equal((await send(server.port, "/")).status, 401);
  assert.equal((await send(server.port, "/api/vaults")).status, 401);
  assert.equal(
    (await send(server.port, "/lumiere/editor?path=/x.md")).status,
    401,
  );
  assert.equal(
    (
      await send(server.port, "/api/vaults", {
        headers: { cookie, host: "rebound.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send(server.port, "/api/vaults", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ path: "/" }),
      })
    ).status,
    403,
  );
});

test("the shell's files stay inside the shell folder", async (t) => {
  const { server, cookie } = await fixture(t);
  for (const escape of [
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e%2f%2e%2e%2fsecret.txt",
  ]) {
    const reply = await send(server.port, escape, { headers: { cookie } });
    assert.ok(
      reply.status === 403 || reply.status === 404,
      `${escape}: ${reply.status}`,
    );
    assert.doesNotMatch(reply.body, /not for pages/);
  }
});

test("the API lists vaults and their files, and refuses what is not a vault", async (t) => {
  const { server, vault, cookie } = await fixture(t);
  const headers = { cookie };
  assert.deepEqual(
    JSON.parse((await send(server.port, "/api/health", { headers })).body),
    {
      ok: true,
      version: "0.0.0-test",
    },
  );
  const list = JSON.parse(
    (await send(server.port, "/api/vaults", { headers })).body,
  ) as { open: string[] };
  assert.deepEqual(list.open, [vault]);
  const files = await send(
    server.port,
    `/api/files?vault=${encodeURIComponent(vault)}`,
    { headers },
  );
  assert.deepEqual(JSON.parse(files.body), {
    files: [{ path: "daily/today.md", kind: "note" }],
    partial: false,
  });

  const outside = await send(
    server.port,
    `/api/files?vault=${encodeURIComponent(path.dirname(vault))}`,
    {
      headers,
    },
  );
  assert.equal(outside.status, 400);
  const bad = await send(server.port, "/api/vaults", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: "{nope",
  });
  assert.equal(bad.status, 400);
  assert.equal(
    (await send(server.port, "/api/nothing", { headers })).status,
    404,
  );
});

test("opening a note from outside reaches the window's event stream", async (t) => {
  const { server, vault, cookie } = await fixture(t);
  const events = await new Promise<string>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        path: "/api/events",
        headers: { host: `127.0.0.1:${server.port}`, cookie },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("data: ")) {
            req.destroy();
            resolve(text);
          }
        });
      },
    );
    req.on("error", (error) => (req.destroyed ? undefined : reject(error)));
    req.end();
    // Once the stream is open, ask the server to show a note.
    setTimeout(() => {
      void send(server.port, "/api/open", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ path: path.join(vault, "daily", "today.md") }),
      });
    }, 50);
  });
  const line =
    events.split("\n").find((item) => item.startsWith("data: ")) ?? "";
  assert.deepEqual(JSON.parse(line.slice("data: ".length)), {
    type: "open",
    vault,
    path: "daily/today.md",
  });
});

test("stopping ends the window's event stream and lets the port go", async (t) => {
  const { server, cookie } = await fixture(t);
  const streamEnded = new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        path: "/api/events",
        headers: { host: `127.0.0.1:${server.port}`, cookie },
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
        res.on("close", resolve);
      },
    );
    req.on("error", reject);
    req.end();
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const deadline = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 3000).unref(),
  );
  assert.notEqual(await Promise.race([server.close(), deadline]), "timeout");
  await streamEnded;
});

test("notes opened before the window listens reach it, in order, when it does", async (t) => {
  const { server, vault, cookie } = await fixture(t);
  await writeFile(path.join(vault, "first.md"), "");
  for (const note of ["first.md", "daily/today.md"]) {
    const opened = await send(server.port, "/api/open", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ path: path.join(vault, note) }),
    });
    assert.equal(opened.status, 200);
  }
  const text = await new Promise<string>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        path: "/api/events",
        headers: { host: `127.0.0.1:${server.port}`, cookie },
      },
      (res) => {
        let received = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          received += chunk;
          if (received.split("data: ").length > 2) {
            req.destroy();
            resolve(received);
          }
        });
      },
    );
    req.on("error", (error) => (req.destroyed ? undefined : reject(error)));
    req.end();
  });
  const paths = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => (JSON.parse(line.slice(6)) as { path: string }).path);
  assert.deepEqual(paths, ["first.md", "daily/today.md"]);
});

/** Every `data:` line of an event stream, read for `ms`. */
function streamEvents(
  port: number,
  { path: route, cookie, ms }: { path: string; cookie: string; ms: number },
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    let received = "";
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: route,
        headers: { host: `127.0.0.1:${port}`, cookie },
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          received += chunk;
        });
      },
    );
    req.on("error", (error) => (req.destroyed ? undefined : reject(error)));
    req.end();
    setTimeout(() => {
      req.destroy();
      resolve(
        received
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6)) as unknown),
      );
    }, ms);
  });
}

test("a note opened before the window listens is kept for the window, not its canvas's stream", async (t) => {
  const { server, vault, cookie } = await fixture(t);
  // The canvas's stream connects first and stays open.
  const canvas = streamEvents(server.port, {
    path: "/api/events?only=ink",
    cookie,
    ms: 400,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const opened = await send(server.port, "/api/open", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ path: path.join(vault, "daily", "today.md") }),
  });
  assert.equal(opened.status, 200);
  const window = await streamEvents(server.port, {
    path: "/api/events",
    cookie,
    ms: 150,
  });
  assert.deepEqual(window, [{ type: "open", vault, path: "daily/today.md" }]);
  assert.deepEqual(await canvas, []);
});

test("the plugins' tree views are served behind the token", async (t) => {
  const { server, cookie } = await fixture(t);
  const listed = await send(server.port, "/lumiere/views", {
    headers: { cookie },
  });
  assert.equal(listed.status, 200);
  // Outline and the other views start with the first note's page (bootstrap
  // defers them); the sidebar waits for them on the views' event stream.
  assert.ok(
    Array.isArray((JSON.parse(listed.body) as { views: unknown }).views),
  );
  assert.equal((await send(server.port, "/lumiere/views")).status, 401);
});

test("the window's layout and theme are kept, and only valid changes apply", async (t) => {
  const { server, cookie } = await fixture(t);
  const headers = { cookie, "content-type": "application/json" };
  assert.deepEqual(
    JSON.parse(
      (await send(server.port, "/api/ui", { headers: { cookie } })).body,
    ),
    {
      sidebar: true,
      outline: true,
      theme: "system",
      folders: {},
      tabs: [],
      activeTab: -1,
    },
  );
  const changed = await send(server.port, "/api/ui", {
    method: "POST",
    headers,
    body: JSON.stringify({
      outline: false,
      theme: "dark",
      sidebar: "maybe",
      folders: { "/v": ["a", "a/b"] },
    }),
  });
  const kept = {
    sidebar: true,
    outline: false,
    theme: "dark",
    folders: { "/v": ["a", "a/b"] },
    tabs: [],
    activeTab: -1,
  };
  assert.deepEqual(JSON.parse(changed.body), kept);
  assert.deepEqual(
    JSON.parse(
      (await send(server.port, "/api/ui", { headers: { cookie } })).body,
    ),
    kept,
  );
});

test("the API closes open vaults, refuses non-note opens, and serves the command palette", async (t) => {
  const { server, vault, cookie } = await fixture(t);
  const headers = { cookie, "content-type": "application/json" };
  await writeFile(path.join(vault, "doc.pdf"), "");
  await writeFile(path.join(vault, "image.png"), "");

  const pdfOpen = await send(server.port, "/api/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: path.join(vault, "doc.pdf") }),
  });
  assert.equal(pdfOpen.status, 200);

  const nonNote = await send(server.port, "/api/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: path.join(vault, "image.png") }),
  });
  assert.equal(nonNote.status, 400);

  const commands = await send(server.port, "/lumiere/commands", {
    headers: { cookie },
  });
  assert.equal(commands.status, 200);
  assert.ok(
    Array.isArray(
      (JSON.parse(commands.body) as { commands: unknown }).commands,
    ),
  );
  assert.equal((await send(server.port, "/lumiere/commands")).status, 401);

  const closed = await send(server.port, "/api/vaults", {
    method: "DELETE",
    headers,
    body: JSON.stringify({ path: vault }),
  });
  assert.equal(closed.status, 200);
  assert.deepEqual((JSON.parse(closed.body) as { open: string[] }).open, []);
  // A closed vault is no longer trusted: no new page opens from it.
  const note = path.join(vault, "daily", "today.md");
  const page = await send(
    server.port,
    `/lumiere/editor?path=${encodeURIComponent(note)}&root=${encodeURIComponent(vault)}`,
    { headers: { cookie } },
  );
  assert.equal(page.status, 403);
});

/** The key the window's own page was given, read as its script would. */
async function windowKey(
  port: number,
  cookie: string,
  metadata: Record<string, string> = { "sec-fetch-dest": "document" },
): Promise<string> {
  const page = await send(port, "/", { headers: { cookie, ...metadata } });
  assert.equal(page.status, 200);
  assert.equal(page.headers["cache-control"], "no-store");
  return (
    new RegExp(`name="${SHELL_KEY_META}" content="([^"]*)"`).exec(
      page.body,
    )?.[1] ?? ""
  );
}

test("only the window's own page is given the key that adds a folder", async (t) => {
  const { server, cookie } = await fixture(t);
  const key = await windowKey(server.port, cookie);
  assert.match(key, /^[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(key, TOKEN);
  // A load of the page the script cannot tell from the window's: an old browser
  // sends no fetch metadata. A fetch or a frame does, and gets no key.
  assert.equal(await windowKey(server.port, cookie, {}), key);
  for (const dest of ["empty", "iframe", "script", "object"]) {
    assert.equal(
      await windowKey(server.port, cookie, { "sec-fetch-dest": dest }),
      "",
      dest,
    );
  }
});

test("a page in the window cannot make the server trust a folder it names", async (t) => {
  // #628: any same-origin page could POST /api/vaults or /api/open.
  const { server, dir, vault, cookie } = await fixture(t);
  const secret = path.join(dir, "private");
  await mkdir(secret);
  await writeFile(path.join(secret, "x.md"), "# x");
  const key = await windowKey(server.port, cookie);
  const page = {
    cookie,
    "content-type": "application/json",
    origin: `http://127.0.0.1:${server.port}`,
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "empty",
  };
  const post = (route: string, body: unknown, headers: object) =>
    send(server.port, route, {
      method: "POST",
      headers: { ...page, ...headers },
      body: JSON.stringify(body),
    });
  const open = async () =>
    (
      JSON.parse(
        (await send(server.port, "/api/vaults", { headers: { cookie } })).body,
      ) as { open: string[] }
    ).open;

  for (const headers of [{}, { [SHELL_KEY_HEADER]: "not-the-key" }]) {
    assert.equal(
      (await post("/api/vaults", { path: secret }, headers)).status,
      403,
    );
    assert.equal(
      (await post("/api/open", { path: path.join(secret, "x.md") }, headers))
        .status,
      403,
    );
  }
  assert.deepEqual(await open(), [vault], "nothing was registered");

  // The window, with the key it was given, can; so can the process that holds
  // the launch token and is no page (the desktop app's open request).
  const own = { [SHELL_KEY_HEADER]: key };
  assert.equal((await post("/api/vaults", { path: secret }, own)).status, 200);
  assert.deepEqual(await open(), [vault, secret]);
});

test("a process that holds the launch token and is no page may still open a folder", async (t) => {
  const { server, dir, vault, cookie } = await fixture(t);
  const other = path.join(dir, "other");
  await mkdir(other);
  await writeFile(path.join(other, "y.md"), "# y");
  const headers = { cookie, "content-type": "application/json" };
  const added = await send(server.port, "/api/vaults", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: other }),
  });
  assert.equal(added.status, 200);
  const opened = await send(server.port, "/api/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: path.join(other, "y.md") }),
  });
  assert.equal(opened.status, 200);
  const list = await send(server.port, "/api/vaults", { headers: { cookie } });
  assert.deepEqual((JSON.parse(list.body) as { open: string[] }).open, [
    vault,
    other,
  ]);
});

test("S5: only the window answers whether git may run in a vault", async (t) => {
  const { server, vault, cookie } = await fixture(t);
  const key = await windowKey(server.port, cookie);
  const waiting = await send(server.port, "/api/git-trust", {
    headers: { cookie },
  });
  assert.equal(waiting.status, 200);
  assert.deepEqual(JSON.parse(waiting.body), { waiting: [] });
  const page = {
    cookie,
    "content-type": "application/json",
    origin: `http://127.0.0.1:${server.port}`,
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "empty",
  };
  const answer = (headers: object) =>
    send(server.port, "/api/git-trust", {
      method: "POST",
      headers: { ...page, ...headers },
      body: JSON.stringify({ vault, allow: true }),
    });
  assert.equal((await answer({})).status, 403);
  // The window may answer, but only a question git asked.
  const own = await answer({ [SHELL_KEY_HEADER]: key });
  assert.equal(own.status, 400);
  assert.match(own.body, /did not ask/);
});
