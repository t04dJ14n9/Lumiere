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
import {
  BASE,
  type EditorAssets,
  type LumiereHost,
} from "@workshop/host-node";
import type { DshContext, DshWebRoute } from "../../src/host/dsh";
import { registerRoutes } from "../../src/host/routes";

interface Fixture {
  readonly origin: string;
  readonly editorQuery: string;
  readonly opened: string[];
  readonly added: string[];
}

/** A real HTTP server in front of DSH's registered prefix handler. */
async function fixture(t: test.TestContext): Promise<Fixture> {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-dsh-methods-")),
  );
  const markdown = path.join(dir, "m");
  const note = path.join(dir, "Note.md");
  const shim = path.join(dir, "shim.js");
  await mkdir(markdown);
  await writeFile(note, "# Note");
  await writeFile(path.join(markdown, "editor.js"), "/* editor */");
  await writeFile(shim, "/* shim */");

  const opened: string[] = [];
  const added: string[] = [];
  const cleanups: Array<() => void | Promise<void>> = [];
  let handler: DshWebRoute["handler"] | undefined;
  const ctx: DshContext = {
    webServer: {
      register(route) {
        handler = route.handler;
        return () => {};
      },
      registerUpgrade() {
        return () => {};
      },
    },
    connection: {
      requestRejection(request) {
        return request.headers["x-dsh-auth"] === "no" ? 401 : undefined;
      },
    },
    effect(start) {
      cleanups.push(start());
      return () => {};
    },
  };
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
    trees: {
      onEvent: () => () => {},
      ids: () => ["tree"],
      snapshot: async () => undefined,
      run: async () => true,
      setVisible: () => {},
    },
    settings: {
      access: {
        contributed: () => [],
        inspect: () => ({ value: 16, target: "user" }),
        update: async () => "user",
      },
    },
    commands: {
      list: () => [],
      run: async () => true,
    },
    addRoot: (uri: string) => {
      added.push(uri);
    },
    workspaceRoots: () => added,
    stop: async () => {},
  } as unknown as LumiereHost;
  registerRoutes(ctx, host, { markdown, shim });
  if (!handler) {
    throw new Error("DSH did not register its prefix handler");
  }
  const answer = handler;
  const server = createServer((req, res) => {
    void Promise.resolve(answer(req, res)).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    });
  });
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup();
    }
    const closed = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    server.closeAllConnections();
    await closed;
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const editorQuery = new URLSearchParams({ path: note, root: dir }).toString();
  return { origin: `http://127.0.0.1:${port}`, editorQuery, opened, added };
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

/** A host whose writes would show a wrong method reaching a route. */
function fakeHost(writes: string[]): LumiereHost {
  return {
    panels: {
      get: () => undefined,
      attach: () => false,
      open: async () => {
        writes.push("panels.open");
        return { id: "p", html: "" };
      },
    },
    trees: {
      ids: () => [],
      snapshot: async () => undefined,
      run: async () => {
        writes.push("views.run");
        return true;
      },
      setVisible: () => {
        writes.push("views.visible");
      },
      onEvent: () => () => {},
    },
    settings: {
      access: {
        contributed: () => [],
        inspect: () => ({ value: undefined }),
        update: async () => {
          writes.push("settings.update");
        },
      },
    },
    commands: {
      list: () => [],
      run: async () => {
        writes.push("commands.run");
        return true;
      },
    },
    addRoot: () => {},
    workspaceRoots: () => [],
    run: async () => {},
    stop: async () => {},
  } as unknown as LumiereHost;
}

async function serve(t: test.TestContext) {
  const writes: string[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  let routeHandler: RouteHandler | undefined;
  const ctx = {
    webServer: {
      register(route: { handler: RouteHandler }) {
        routeHandler = route.handler;
        return () => {};
      },
      registerUpgrade: () => () => {},
    },
    connection: { requestRejection: () => undefined },
    effect(start: () => () => void | Promise<void>) {
      cleanups.push(start());
      return undefined;
    },
  } as unknown as DshContext;
  const assets: EditorAssets = { markdown: "/none", shim: "/none" };
  registerRoutes(ctx, fakeHost(writes), assets);
  const server = createServer((req, res) => {
    if (routeHandler) {
      void routeHandler(req, res);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup();
    }
    server.close();
  });
  const { port } = server.address() as { port: number };
  return {
    url: (rest: string) => `http://127.0.0.1:${port}/lumiere${rest}`,
    writes,
  };
}

function jsonPost(body: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
}

test("DSH rejects writes to read-only routes before handling them", async (t) => {
  const { origin, editorQuery, opened, added } = await fixture(t);
  const readOnly = [
    `/editor?${editorQuery}`,
    "/m/editor.js",
    "/page/shim.js",
    "/file?panel=p1",
    "/pdf",
    "/pdf/viewer/viewer.js",
    "/pdf/bytes?page=p1&load=1",
  ];
  const methods = ["POST", "PUT", "DELETE", "OPTIONS"] as const;

  // Authentication comes first: a refused request learns no route methods.
  const refused = await fetch(`${origin}${BASE}/editor?${editorQuery}`, {
    method: "POST",
    headers: { "x-dsh-auth": "no" },
  });
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get("allow"), null);
  await refused.arrayBuffer();

  for (const rest of readOnly) {
    for (const method of methods) {
      const response = await fetch(`${origin}${BASE}${rest}`, { method });
      assert.equal(response.status, 405, `${method} ${rest}`);
      assert.equal(
        response.headers.get("allow"),
        "GET, HEAD",
        `${method} ${rest}`,
      );
      assert.equal(await response.text(), "", `${method} ${rest}`);
    }
  }
  // The editor query names a real note: without the gate, POST would open it.
  assert.deepEqual(opened, []);
  assert.deepEqual(added, []);

  const get = await fetch(`${origin}${BASE}/m/editor.js`);
  assert.equal(get.status, 200);
  assert.equal(await get.text(), "/* editor */");
  const head = await fetch(`${origin}${BASE}/m/editor.js`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const shim = await fetch(`${origin}${BASE}/page/shim.js`);
  assert.equal(shim.status, 200);
  assert.equal(await shim.text(), "/* shim */");

  const post = async (rest: string, body: unknown) => {
    const response = await fetch(`${origin}${BASE}${rest}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await response.arrayBuffer();
    return response.status;
  };
  assert.equal(await post("/views/tree/run", { id: "n" }), 200);
  assert.equal(await post("/views/tree/visible", { visible: true }), 200);
  assert.equal(await post("/commands", { command: "test" }), 200);
  assert.equal(await post("/settings", {}), 400, "settings checked the body");

  const editor = await fetch(`${origin}${BASE}/editor?${editorQuery}`);
  assert.equal(editor.status, 200, "GET still opens an editor page");
  await editor.text();
  assert.deepEqual(opened, ["p1"]);
  assert.equal(added.length, 1);
});

test("wrong methods on JSON routes are JSON 405s with Allow, before any write", async (t) => {
  const { url, writes } = await serve(t);
  const cases = [
    ["PUT", "/settings"],
    ["PUT", "/commands"],
    ["PUT", "/views/outline/run"],
    ["OPTIONS", "/settings"],
  ] as const;
  for (const [method, rest] of cases) {
    const init: RequestInit = { method };
    if (method === "PUT") {
      init.headers = { "content-type": "application/json" };
      init.body = "{not json";
    }
    const response = await fetch(url(rest), init);
    assert.equal(response.status, 405, `${method} ${rest}`);
    assert.equal(response.headers.get("allow"), "GET, POST, HEAD");
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json/,
    );
    assert.deepEqual(await response.json(), {
      error: "Method Not Allowed",
    });
  }
  assert.deepEqual(writes, []);
});

test("HEAD is a bodyless GET and POST still reaches the JSON handlers", async (t) => {
  const { url, writes } = await serve(t);
  const head = await fetch(url("/settings"), { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(await head.text(), "");

  const bad = await fetch(url("/settings"), jsonPost("{not json"));
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "Invalid request body" });

  const command = await fetch(url("/commands"), jsonPost('{"command":"x"}'));
  assert.equal(command.status, 200);
  assert.deepEqual(await command.json(), { ok: true });

  const view = await fetch(url("/views/outline/run"), jsonPost('{"id":"h1"}'));
  assert.equal(view.status, 200);
  assert.deepEqual(await view.json(), { ok: true });
  assert.deepEqual(writes, ["commands.run", "views.run"]);
});

test("read-only 405s and unknown paths are unchanged", async (t) => {
  const { url, writes } = await serve(t);
  const readOnly = await fetch(url("/page/shim.js"), { method: "POST" });
  assert.equal(readOnly.status, 405);
  assert.equal(readOnly.headers.get("allow"), "GET, HEAD");
  assert.equal(await readOnly.text(), "");

  const unknown = await fetch(url("/not-a-route"), { method: "PUT" });
  assert.equal(unknown.status, 404);
  assert.deepEqual(writes, []);
});
