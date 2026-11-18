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

/**
 * Editor pages over a real server and a host that keeps roots as `startHost`
 * does (a set, trailing slash dropped). `status` asks for the page of a note
 * from a workspace; `register` is the embedder registering one, as the app does
 * for a vault and DSH for a session's workspace. `added` is every `addRoot`.
 */
async function serveEditorPages(t: {
  after(callback: () => void | Promise<void>): void;
}) {
  const roots = new Set<string>();
  const added: string[] = [];
  const opened: string[] = [];
  const host = {
    panels: {
      open: async () => {
        opened.push("p1");
        return {
          id: "p1",
          html: '<!doctype html><html><head><meta charset="UTF-8"></head><body><script type="module" nonce="n" src="/e.js"></script></body></html>',
        };
      },
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
  const routes = createEditorRoutes(host, {
    markdown: "/none",
    shim: "/none",
    pdf: "/none",
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
  // Without a root the page names no workspace: the note's folder is checked.
  const status = async (note: string, root?: string) =>
    (
      await fetch(
        `http://127.0.0.1:${port}/lumiere/${/\.pdf$/i.test(note) ? "pdf" : "editor"}?path=${encodeURIComponent(note)}${root === undefined ? "" : `&root=${encodeURIComponent(root)}`}`,
      )
    ).status;
  const register = (folder: string) =>
    host.addRoot(pathToFileURL(folder).toString());
  return { host, added, opened, status, register };
}

/** Real notes under a scratch folder, which is removed when the test ends. */
async function notes(
  t: { after(callback: () => void | Promise<void>): void },
  files: readonly string[],
): Promise<{ scratch: string; at: (...parts: string[]) => string }> {
  // macOS's temporary folder is behind a symlink; the route resolves it.
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-roots-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  for (const file of files) {
    await mkdir(path.dirname(path.join(scratch, file)), { recursive: true });
    await writeFile(path.join(scratch, file), "# Note");
  }
  return { scratch, at: (...parts) => path.join(scratch, ...parts) };
}

test("an editor page opens from a workspace the embedder registered, and registers none itself", async (t) => {
  const { at } = await notes(t, ["vault/Note.md", "vault/docs/Deep.md"]);
  const { added, opened, status, register } = await serveEditorPages(t);
  register(at("vault"));
  assert.deepEqual(added, [pathToFileURL(at("vault")).toString()]);

  assert.equal(await status(at("vault", "Note.md"), at("vault")), 200);
  // A folder inside the workspace only narrows what the page can reach.
  assert.equal(
    await status(at("vault", "docs", "Deep.md"), at("vault", "docs")),
    200,
  );
  assert.deepEqual(opened, ["p1", "p1"]);
  assert.deepEqual(added, [pathToFileURL(at("vault")).toString()]);
});

test("an editor page cannot make the host trust a folder it names", async (t) => {
  // #628: ?path=<note in a private folder>&root=<that folder>.
  const { at } = await notes(t, ["vault/Note.md", "private/Secret.md"]);
  const { added, opened, status, register } = await serveEditorPages(t);
  assert.equal(
    await status(at("private", "Secret.md"), at("private")),
    403,
    "nothing is registered yet",
  );
  register(at("vault"));
  assert.equal(
    await status(at("private", "Secret.md"), at("private")),
    403,
    "a registered vault does not make its sibling trusted",
  );
  assert.equal(await status(at("vault", "Note.md"), at("vault")), 200);
  assert.deepEqual(added, [pathToFileURL(at("vault")).toString()]);
  assert.deepEqual(opened, ["p1"]);

  // Only the embedder's registration opens it.
  register(at("private"));
  assert.equal(await status(at("private", "Secret.md"), at("private")), 200);
});

test("an editor page cannot name a folder that holds a registered workspace", async (t) => {
  const { scratch, at } = await notes(t, [
    "vault/Top.md",
    "vault/docs/Deep.md",
  ]);
  const { added, status, register } = await serveEditorPages(t);
  register(at("vault", "docs"));
  assert.equal(
    await status(at("vault", "docs", "Deep.md"), at("vault", "docs")),
    200,
  );
  assert.equal(await status(at("vault", "Top.md"), at("vault")), 403);
  assert.equal(
    await status(at("vault", "docs", "Deep.md"), scratch),
    403,
    "nor its parent",
  );
  assert.deepEqual(added, [pathToFileURL(at("vault", "docs")).toString()]);

  // A folder the embedder itself registers, as the app does for a vault that
  // holds another vault, is a workspace like any other.
  register(at("vault"));
  assert.equal(await status(at("vault", "Top.md"), at("vault")), 200);
  assert.equal(await status(at("vault", "docs", "Deep.md"), scratch), 403);
});

test("a PDF's page is held to the same registered workspaces", async (t) => {
  const { at } = await notes(t, ["vault/Doc.pdf", "private/Secret.pdf"]);
  const { added, status, register } = await serveEditorPages(t);
  assert.equal(await status(at("private", "Secret.pdf"), at("private")), 403);
  register(at("vault"));
  assert.equal(await status(at("vault", "Doc.pdf"), at("vault")), 200);
  assert.equal(await status(at("private", "Secret.pdf"), at("private")), 403);
  assert.deepEqual(added, [pathToFileURL(at("vault")).toString()]);
});

test("a registered filesystem root authorizes no folder", async (t) => {
  const { at } = await notes(t, ["vault/Note.md"]);
  const { host, status } = await serveEditorPages(t);
  // How an embedder's mistake would look, with its trailing slash dropped.
  host.addRoot("file:///");
  assert.equal(await status(at("vault", "Note.md"), at("vault")), 403);
});

test("a page that names no workspace opens only from a registered one, and registers nothing", async (t) => {
  // DSH names no root for a note opened by absolute path: the note's folder
  // is the page's root, and it is held to what DSH registered for the session.
  const { scratch, at } = await notes(t, [
    "workspace/Top.md",
    "workspace/docs/Deep.md",
    "Loose.md",
  ]);
  const { added, status, register } = await serveEditorPages(t);
  assert.equal(await status(at("workspace", "docs", "Deep.md")), 403);
  assert.deepEqual(added, [], "the note's folder is not registered");

  register(at("workspace"));
  assert.equal(await status(at("workspace", "docs", "Deep.md")), 200);
  assert.equal(await status(at("workspace", "Top.md"), at("workspace")), 200);
  assert.equal(await status(at("Loose.md")), 403, "outside the workspace");
  assert.equal(await status(at("workspace", "Top.md"), scratch), 403);
  assert.deepEqual(added, [pathToFileURL(at("workspace")).toString()]);
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
    workspaceRoots: () => [pathToFileURL(dir).toString()],
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
