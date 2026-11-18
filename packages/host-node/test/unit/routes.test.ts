import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { BASE, createEditorRoutes, SOCKET_PATH } from "../../src/host/routes";
import type { LumiereHost } from "../../src/host/start";
import { TreeHub } from "../../src/host/trees";
import { createViewRoutes } from "../../src/host/view-routes";

/** A host with one panel, "p", whose page socket goes nowhere. */
function fakeHost(): LumiereHost {
  return {
    panels: {
      get: (id: string) => (id === "p" ? { id } : undefined),
      attach: () => true,
    },
    trees: new TreeHub({ execute: async () => undefined }),
    addRoot: () => {},
    workspaceRoots: () => [],
    stop: async () => {},
  } as unknown as LumiereHost;
}

test("closing the routes ends open page sockets, so the web server can stop", async (t) => {
  const routes = createEditorRoutes(fakeHost(), {
    markdown: "/none",
    shim: "/none",
  });
  const server = createServer((_req, res) => res.writeHead(404).end());
  server.on("upgrade", (req, socket, head) => {
    if (!routes.upgrade(req, socket, head)) {
      socket.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as { port: number };

  const page = new WebSocket(`ws://127.0.0.1:${port}${SOCKET_PATH}?panel=p`);
  await new Promise((resolve, reject) => {
    page.once("open", resolve);
    page.once("error", reject);
  });
  const pageClosed = new Promise((resolve) => page.once("close", resolve));

  routes.close();
  server.closeAllConnections();
  const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
  const deadline = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 2000).unref(),
  );
  assert.notEqual(await Promise.race([stopped, deadline]), "timeout");
  await pageClosed;
});

test("a socket for an unknown panel or another path is not taken", async (t) => {
  const routes = createEditorRoutes(fakeHost(), {
    markdown: "/none",
    shim: "/none",
  });
  t.after(() => routes.close());
  const request = (url: string) => ({ url, headers: {} }) as never;
  assert.equal(
    routes.upgrade(
      request(`${SOCKET_PATH}?panel=nope`),
      {} as never,
      Buffer.alloc(0),
    ),
    false,
  );
  assert.equal(
    routes.upgrade(request("/other?panel=p"), {} as never, Buffer.alloc(0)),
    false,
  );
});

test("tree views are served as snapshots, clicks and visibility", async (t) => {
  const ran: unknown[] = [];
  const host = fakeHost();
  (host as { trees: TreeHub }).trees = new TreeHub({
    execute: async (...args: unknown[]) => {
      ran.push(args);
      return undefined;
    },
  });
  const handle = host.trees.tree("lumiere.markdown.outline", {
    roots: () => [
      { id: "h1", label: "Title", command: { id: "open", args: [3] } },
    ],
    children: () => [],
  });
  const routes = createEditorRoutes(host, { markdown: "/none", shim: "/none" });
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    routes.close();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}/lumiere/views`;

  assert.deepEqual(await (await fetch(base)).json(), {
    views: ["lumiere.markdown.outline"],
  });
  const snapshot = (await (
    await fetch(`${base}/lumiere.markdown.outline`)
  ).json()) as {
    items: { id: string }[];
  };
  assert.deepEqual(
    snapshot.items.map((item) => item.id),
    ["h1"],
  );
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });
  const postRaw = (path: string, body: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  assert.equal(
    (await post("/lumiere.markdown.outline/run", { id: "h1" })).status,
    200,
  );
  assert.deepEqual(ran, [["open", 3]]);
  assert.equal(
    (await post("/lumiere.markdown.outline/run", { id: "zz" })).status,
    404,
  );
  const heard: boolean[] = [];
  handle.onVisibilityChanged((visible) => heard.push(visible));
  assert.equal(
    (await post("/lumiere.markdown.outline/visible", { visible: true })).status,
    200,
  );
  assert.equal(
    (await post("/lumiere.markdown.outline/visible", { visible: "yes" }))
      .status,
    400,
  );
  assert.deepEqual(heard, [true]);
  for (const body of [
    "{",
    "[]",
    "null",
    '"text"',
    "42",
    "",
    JSON.stringify({ id: "x".repeat(4 * 1024) }),
  ]) {
    const response = await postRaw("/lumiere.markdown.outline/run", body);
    assert.equal(response.status, 400, body.slice(0, 32));
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json/,
    );
    assert.deepEqual(await response.json(), { error: "Invalid request body" });
  }
  const badViewId = await postRaw("/%C3%28/run", '{"id":"h1"}');
  assert.equal(badViewId.status, 400);
  assert.deepEqual(await badViewId.json(), { error: "Invalid view id" });
  assert.deepEqual(ran, [["open", 3]]);
  assert.equal((await fetch(`${base}/unknown.view`)).status, 404);
});

test("a tree command failure is not reported as a bad body", async (t) => {
  const trees = {
    onEvent: () => () => {},
    run: async () => {
      throw new Error("command failed");
    },
  } as unknown as TreeHub;
  const routes = createViewRoutes(trees);
  t.after(() => routes.close());
  const req = Object.assign(Readable.from([Buffer.from('{"id":"h1"}')]), {
    method: "POST",
  }) as unknown as IncomingMessage;
  await assert.rejects(
    routes.handle(req, {} as ServerResponse, "/view/run"),
    /command failed/,
  );
});

test("serving an editor page registers the workspace root before opening the panel", async (t) => {
  // macOS's temporary folder is behind a symlink; the route resolves it.
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-route-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  const notePath = path.join(dir, "First.md");
  await writeFile(notePath, "# First");

  const order: string[] = [];
  const registered: string[] = [];
  const host = {
    panels: {
      open: async () => {
        order.push("open");
        return {
          id: "p1",
          html: '<!doctype html><html><head><meta charset="UTF-8"></head><body><script type="module" nonce="abc123" src="/e.js"></script></body></html>',
        };
      },
      get: () => undefined,
      attach: () => false,
    },
    trees: new TreeHub({ execute: async () => undefined }),
    addRoot: (uri: string) => {
      registered.push(uri);
      order.push(`addRoot:${uri}`);
    },
    workspaceRoots: () => registered,
    stop: async () => {},
  } as unknown as LumiereHost;

  const routes = createEditorRoutes(host, { markdown: "/none", shim: "/none" });
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    routes.close();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const response = await fetch(
    `http://127.0.0.1:${port}/lumiere/editor?path=${encodeURIComponent(notePath)}&root=${encodeURIComponent(dir)}`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(order, [`addRoot:${pathToFileURL(dir).toString()}`, "open"]);
});

test("an editor page cannot widen the workspace root to a parent folder", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-widen-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const vault = path.join(scratch, "vault");
  await mkdir(vault);
  const notePath = path.join(vault, "Note.md");
  await writeFile(notePath, "# Note");
  await writeFile(path.join(scratch, "secret.md"), "secret");

  const added: string[] = [];
  const host = {
    panels: {
      open: async () => ({
        id: "p1",
        html: '<!doctype html><html><head><meta charset="UTF-8"></head><body><script type="module" nonce="n" src="/e.js"></script></body></html>',
      }),
      get: () => undefined,
      attach: () => false,
    },
    trees: new TreeHub({ execute: async () => undefined }),
    addRoot: (uri: string) => {
      added.push(uri);
    },
    workspaceRoots: () => added,
    stop: async () => {},
  } as unknown as LumiereHost;

  const routes = createEditorRoutes(host, { markdown: "/none", shim: "/none" });
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    routes.close();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const editor = (note: string, root: string) =>
    `http://127.0.0.1:${port}/lumiere/editor?path=${encodeURIComponent(note)}&root=${encodeURIComponent(root)}`;
  assert.equal((await fetch(editor(notePath, vault))).status, 200);
  assert.deepEqual(added, [pathToFileURL(vault).toString()]);
  assert.equal((await fetch(editor(notePath, scratch))).status, 403);
  assert.deepEqual(added, [pathToFileURL(vault).toString()]);
});

/**
 * Editor pages over a real server and a host that keeps roots as `startHost`
 * does (a set, trailing slash dropped). Returns the page URL for a note and
 * the workspace it names, and what the routes registered.
 */
async function serveEditorPages(t: {
  after(callback: () => void | Promise<void>): void;
}) {
  const roots = new Set<string>();
  const added: string[] = [];
  const host = {
    panels: {
      open: async () => ({
        id: "p1",
        html: '<!doctype html><html><head><meta charset="UTF-8"></head><body><script type="module" nonce="n" src="/e.js"></script></body></html>',
      }),
      get: () => undefined,
      attach: () => false,
    },
    trees: new TreeHub({ execute: async () => undefined }),
    addRoot: (uri: string) => {
      added.push(uri);
      roots.add(uri.replace(/\/+$/, ""));
    },
    workspaceRoots: () => [...roots],
    stop: async () => {},
  } as unknown as LumiereHost;
  const routes = createEditorRoutes(host, { markdown: "/none", shim: "/none" });
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    routes.close();
    server.close();
  });
  const { port } = server.address() as { port: number };
  // Without a root the page names no workspace: the note's folder stands in.
  const status = async (note: string, root?: string) =>
    (
      await fetch(
        `http://127.0.0.1:${port}/lumiere/editor?path=${encodeURIComponent(note)}${root === undefined ? "" : `&root=${encodeURIComponent(root)}`}`,
      )
    ).status;
  return { host, added, status };
}

test("DSH opens a second session's workspace and a note's own folder after the first", async (t) => {
  // DSH registers no root itself: every session's workspace, and the folder of
  // a note named by an absolute address, reach the host through this route.
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-sessions-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = async (...parts: string[]) => {
    const file = path.join(scratch, ...parts);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "# Note");
    return file;
  };
  const first = await note("projA", "Note.md");
  const second = await note("projB", "Note.md");
  const loose = await note("loose", "Idea.md");
  const inside = await note("projA", "docs", "Deep.md");

  const { added, status } = await serveEditorPages(t);
  const folder = (file: string) => path.dirname(file);
  assert.equal(await status(first, folder(first)), 200, "first session");
  assert.equal(await status(second, folder(second)), 200, "second session");
  assert.equal(await status(loose, folder(loose)), 200, "a note's own folder");
  assert.equal(await status(inside, folder(first)), 200, "inside the first");
  assert.deepEqual(
    added,
    [first, second, loose].map((file) =>
      pathToFileURL(folder(file)).toString(),
    ),
  );
});

test("an editor page still cannot name a folder that holds a registered workspace", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-holds-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const vault = path.join(scratch, "vault");
  const docs = path.join(vault, "docs");
  await mkdir(docs, { recursive: true });
  const deep = path.join(docs, "Deep.md");
  const top = path.join(vault, "Top.md");
  await writeFile(deep, "# Deep");
  await writeFile(top, "# Top");

  const { host, added, status } = await serveEditorPages(t);
  assert.equal(await status(deep, docs), 200);
  assert.equal(
    await status(top, vault),
    403,
    "the vault holds the docs folder",
  );
  assert.equal(await status(deep, scratch), 403, "so does its parent");
  assert.deepEqual(added, [pathToFileURL(docs).toString()]);

  // A folder the embedder itself registered, as the app does for a vault, is
  // not a widening even when it holds another registered folder.
  host.addRoot(pathToFileURL(vault).toString());
  assert.equal(await status(top, vault), 200);
  assert.equal(await status(deep, scratch), 403);
});

test("a note opened by absolute path does not lock its session's workspace out", async (t) => {
  // DSH names no workspace for a note opened by absolute path, so the page
  // names no root and the note's folder stands in. The session's workspace,
  // which holds that folder, may still open afterwards.
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-folder-first-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const workspace = path.join(scratch, "workspace");
  const docs = path.join(workspace, "docs");
  await mkdir(docs, { recursive: true });
  const deep = path.join(docs, "Deep.md");
  const top = path.join(workspace, "Top.md");
  await writeFile(deep, "# Deep");
  await writeFile(top, "# Top");

  const { added, status } = await serveEditorPages(t);
  assert.equal(await status(deep), 200, "the note's own folder");
  assert.equal(await status(top, workspace), 200, "its session's workspace");
  assert.equal(await status(deep, workspace), 200);
  // The workspace that arrived is a named one: nothing may widen it now.
  assert.equal(await status(top, scratch), 403, "a folder above it");
  assert.deepEqual(
    added,
    [docs, workspace].map((folder) => pathToFileURL(folder).toString()),
  );
});

test("a named workspace is not widened through a note folder inside it", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-named-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const vault = path.join(scratch, "vault");
  const docs = path.join(vault, "docs");
  await mkdir(docs, { recursive: true });
  const deep = path.join(docs, "Deep.md");
  const loose = path.join(scratch, "Loose.md");
  await writeFile(deep, "# Deep");
  await writeFile(loose, "# Loose");

  const { status } = await serveEditorPages(t);
  // Named first, then the same folder as a note's own: it stays named.
  assert.equal(await status(deep, docs), 200);
  assert.equal(await status(deep), 200);
  assert.equal(await status(loose), 403, "its folder holds the named one");
  assert.equal(await status(deep, vault), 403);
});

const ROUTE_INDEX = {
  name: "lumiere",
  routes: [
    `${BASE}/editor`,
    `${BASE}/m/`,
    `${BASE}/page/shim.js`,
    `${BASE}/file`,
    `${BASE}/views`,
    `${BASE}/settings`,
    SOCKET_PATH,
  ],
} as const;

test("the exact /lumiere base returns a JSON route index", async (t) => {
  const routes = createEditorRoutes(fakeHost(), {
    markdown: "/none",
    shim: "/none",
  });
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    routes.close();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;

  const exact = await fetch(`${origin}${BASE}`);
  assert.equal(exact.status, 200);
  assert.match(exact.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(exact.headers.get("cache-control"), "no-store");
  assert.deepEqual(await exact.json(), ROUTE_INDEX);

  const withQuery = await fetch(`${origin}${BASE}?probe=1`);
  assert.equal(withQuery.status, 200);
  assert.deepEqual(await withQuery.json(), ROUTE_INDEX);

  const head = await fetch(`${origin}${BASE}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(await head.text(), "");

  // Exact pathname only: a trailing slash is not this index.
  const trailing = await fetch(`${origin}${BASE}/`);
  assert.equal(trailing.status, 404);
  assert.doesNotMatch(
    trailing.headers.get("content-type") ?? "",
    /application\/json/,
  );
  assert.equal((await fetch(`${origin}${BASE}x`)).status, 404);
});

test("the route index lists commands and PDF only when the host serves them", async (t) => {
  const routes = createEditorRoutes(
    { ...fakeHost(), commands: {} } as unknown as LumiereHost,
    { markdown: "/none", shim: "/none", pdf: "/none" },
  );
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    routes.close();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const index = (await (
    await fetch(`http://127.0.0.1:${port}${BASE}`)
  ).json()) as { routes: string[] };
  assert.deepEqual(index.routes.slice(-3), [
    `${BASE}/commands`,
    `${BASE}/pdf`,
    SOCKET_PATH,
  ]);
});

test("note media and the built editor both answer one byte range", async (t) => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-range-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  const note = path.join(dir, "Note.md");
  const media = path.join(dir, "clip.mp4");
  const asset = path.join(dir, "editor.js");
  await writeFile(note, "# Note");
  await writeFile(media, "0123456789");
  await writeFile(asset, "abcdefghij");

  const host = {
    panels: {
      open: async () => ({
        id: "p1",
        html: '<!doctype html><html><head><meta charset="UTF-8"></head><body><script type="module" nonce="n" src="/e.js"></script></body></html>',
      }),
      get: () => undefined,
      attach: () => false,
    },
    trees: new TreeHub({ execute: async () => undefined }),
    addRoot: () => {},
    workspaceRoots: () => [],
    stop: async () => {},
  } as unknown as LumiereHost;
  const routes = createEditorRoutes(host, { markdown: dir, shim: asset });
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    routes.close();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(
    `${base}/lumiere/editor?path=${encodeURIComponent(note)}&root=${encodeURIComponent(dir)}`,
  );
  assert.equal(page.status, 200);
  await page.text();

  const urls = [
    `${base}/lumiere/file?panel=p1&uri=${encodeURIComponent(pathToFileURL(media).toString())}`,
    `${base}/lumiere/m/editor.js`,
  ];
  for (const url of urls) {
    const part = await fetch(url, { headers: { range: "bytes=2-4" } });
    assert.equal(part.status, 206, url);
    assert.equal(part.headers.get("content-range"), "bytes 2-4/10");
    assert.equal((await part.text()).length, 3);

    const ignored = await fetch(url, { headers: { range: "items=0-2" } });
    assert.equal(ignored.status, 200, url);
    assert.equal((await ignored.text()).length, 10);

    const past = await fetch(url, { headers: { range: "bytes=99-" } });
    assert.equal(past.status, 416, url);
    assert.equal(past.headers.get("content-range"), "bytes */10");
    await past.text();
  }
});
