import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createPdfRoutes, type PdfRoutes } from "../../src/host/pdf-routes";
import type { PageSocket } from "../../src/host/panel";

const PDF = "%PDF-1.4\n% a stand-in: the viewer, not the host, reads PDFs\n";

interface Fixture {
  readonly origin: string;
  readonly dir: string;
  readonly vault: string;
  readonly viewer: string;
  readonly outside: string;
  readonly routes: PdfRoutes;
  /** The workspaces the embedder registered; the vault to begin with. */
  readonly registered: string[];
}

async function fixture(t: test.TestContext): Promise<Fixture> {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-pdf-")),
  );
  const vault = path.join(dir, "vault");
  const viewer = path.join(dir, "viewer");
  await mkdir(path.join(vault, "papers"), { recursive: true });
  await mkdir(viewer);
  await writeFile(path.join(vault, "papers", "A.pdf"), PDF);
  await writeFile(path.join(vault, "Note.md"), "# Note");
  await writeFile(path.join(dir, "outside.pdf"), PDF);
  await writeFile(path.join(viewer, "viewer.js"), "/* viewer */");
  const registered = [pathToFileURL(vault).toString()];
  const routes = createPdfRoutes({
    base: "/lumiere",
    viewer,
    roots: () => registered,
    log: () => {},
  });
  const server: Server = createServer((req, res) => {
    const rest = new URL(req.url ?? "/", "http://x").pathname.slice(
      "/lumiere".length,
    );
    void routes.handle(req, res, rest).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    routes.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    dir,
    vault,
    viewer,
    outside: path.join(dir, "outside.pdf"),
    routes,
    registered,
  };
}

function pageUrl(origin: string, file: string, root: string): string {
  const query = new URLSearchParams({ path: file, root });
  return `${origin}/lumiere/pdf?${query.toString()}`;
}

/** Symlink containment is meaningless on a host that cannot create links. */
async function linkOrSkip(
  t: test.TestContext,
  target: string,
  link: string,
): Promise<boolean> {
  try {
    await symlink(target, link);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" ||
      code === "EPERM" ||
      code === "ENOTSUP"
    ) {
      t.skip("creating symlinks is not supported on this platform");
      return false;
    }
    throw error;
  }
}

/** The page's end of its socket, as the shim would hold it. */
function fakeSocket() {
  const received: unknown[] = [];
  let deliver: (text: string) => void = () => {};
  let closed: () => void = () => {};
  const socket: PageSocket = {
    send: (text) => received.push(JSON.parse(text)),
    onMessage: (listener) => {
      deliver = listener;
      return () => {};
    },
    onClose: (listener) => {
      closed = listener;
      return () => {};
    },
    close: () => {},
  };
  return {
    socket,
    received,
    fromPage: (data: unknown) => deliver(JSON.stringify({ ch: "rpc", data })),
    close: () => closed(),
  };
}

async function until<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

test("a PDF's page runs the viewer with the shim, and its bytes are served by load", async (t) => {
  const { origin, vault, routes } = await fixture(t);
  const response = await fetch(
    pageUrl(origin, path.join(vault, "papers", "A.pdf"), vault),
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  const id = /name="lumiere-panel" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(id, "the page names its panel for the shim");
  const nonce = /nonce="([^"]+)"/.exec(html)?.[1];
  assert.ok(
    html.includes(`<script nonce="${nonce}" src="/lumiere/page/shim.js">`),
  );
  assert.ok(
    html.indexOf("/lumiere/page/shim.js") <
      html.indexOf("/lumiere/pdf/viewer/viewer.js"),
    "the shim runs before the viewer",
  );
  assert.match(
    html,
    /data-pdfium-wasm="\/lumiere\/m\/webview\/embedpdf\.wasm"/,
  );
  assert.match(html, /connect-src 'self' ws:\/\/127\.0\.0\.1:\d+/);
  assert.match(html, /data-toolbar="slim"/);

  const page = routes.page(id);
  assert.ok(page);
  const socket = fakeSocket();
  page.attach(socket.socket);
  socket.fromPage({ type: "ready" });
  const load = await until(
    () =>
      socket.received.find(
        (frame) =>
          (frame as { data?: { type?: string } }).data?.type === "load",
      ) as { ch: string; data: { load: number; url: string } } | undefined,
  );
  assert.equal(load.ch, "rpc");
  const bytes = await fetch(origin + load.data.url);
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers.get("content-type"), "application/pdf");
  assert.equal(await bytes.text(), PDF);
  const stale = new URL(origin + load.data.url);
  stale.searchParams.set("load", String(load.data.load + 1));
  assert.equal((await fetch(stale)).status, 404);

  socket.close();
  assert.equal(routes.page(id), undefined, "a closed page is dropped");
  assert.equal((await fetch(origin + load.data.url)).status, 404);
});

test("only a PDF inside its workspace opens", async (t) => {
  const { origin, vault, outside } = await fixture(t);
  const status = async (file: string, root = vault) =>
    (await fetch(pageUrl(origin, file, root))).status;
  assert.equal(await status(path.join(vault, "Note.md")), 400);
  assert.equal(await status(outside), 400, "outside the workspace");
  assert.equal(
    await status(path.join(vault, "papers", "..", "..", "outside.pdf")),
    400,
  );
  assert.equal(await status(path.join(vault, "papers", "Missing.pdf")), 403);
});

test("a PDF page opens only from a workspace the embedder registered", async (t) => {
  // #628: ?path=<a readable PDF>&root=<its folder> must not open it.
  const { origin, dir, vault, outside, registered } = await fixture(t);
  const status = async (file: string, root: string) =>
    (await fetch(pageUrl(origin, file, root))).status;
  assert.equal(await status(outside, dir), 403, "a folder nobody registered");
  assert.equal(
    await status(
      path.join(vault, "papers", "A.pdf"),
      path.join(vault, "papers"),
    ),
    200,
    "a folder inside the registered vault",
  );

  registered.length = 0;
  assert.equal(
    await status(path.join(vault, "papers", "A.pdf"), vault),
    403,
    "nothing registered",
  );
  registered.push(pathToFileURL(dir).toString());
  assert.equal(
    await status(outside, dir),
    200,
    "once the embedder registers it",
  );

  // A filesystem root holds every folder and so trusts none.
  registered.length = 0;
  registered.push("file:///");
  assert.equal(await status(outside, dir), 403);
});

test("the viewer's files are served from its folder only", async (t) => {
  const { origin } = await fixture(t);
  const viewer = await fetch(`${origin}/lumiere/pdf/viewer/viewer.js`);
  assert.equal(viewer.status, 200);
  assert.equal(await viewer.text(), "/* viewer */");
  const escape = await fetch(
    `${origin}/lumiere/pdf/viewer/..%2F..%2Fvault%2FNote.md`,
  );
  assert.notEqual(escape.status, 200);
});

test("a PDF in a workspace reached through a symlink still reads its bytes", async (t) => {
  const { origin, dir, vault, routes } = await fixture(t);
  const linked = path.join(dir, "linked-vault");
  if (!(await linkOrSkip(t, vault, linked))) {
    return;
  }
  const response = await fetch(
    pageUrl(origin, path.join(linked, "papers", "A.pdf"), linked),
  );
  assert.equal(response.status, 200);
  const id = /name="lumiere-panel" content="([^"]+)"/.exec(
    await response.text(),
  )?.[1];
  const page = id ? routes.page(id) : undefined;
  assert.ok(page);
  const socket = fakeSocket();
  page.attach(socket.socket);
  socket.fromPage({ type: "ready" });
  const load = await until(
    () =>
      socket.received.find(
        (frame) =>
          (frame as { data?: { type?: string } }).data?.type === "load",
      ) as { data: { url: string } } | undefined,
  );
  const bytes = await fetch(origin + load.data.url);
  assert.equal(bytes.status, 200);
  assert.equal(await bytes.text(), PDF);
  socket.close();
});

test("a PDF page refuses a symlink that leaves the workspace", async (t) => {
  const { origin, vault, outside } = await fixture(t);
  const link = path.join(vault, "papers", "escape.pdf");
  if (!(await linkOrSkip(t, outside, link))) {
    return;
  }
  const response = await fetch(pageUrl(origin, link, vault));
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "");
});

test("a viewer file that symlinks outside its folder is refused", async (t) => {
  const { origin, viewer, outside } = await fixture(t);
  const link = path.join(viewer, "escape.js");
  if (!(await linkOrSkip(t, outside, link))) {
    return;
  }
  const response = await fetch(`${origin}/lumiere/pdf/viewer/escape.js`);
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "");
});

test("PDF bytes re-check real-path containment after the file changes", async (t) => {
  const { origin, vault, outside, routes } = await fixture(t);
  const pdf = path.join(vault, "papers", "A.pdf");
  const opened = await fetch(pageUrl(origin, pdf, vault));
  assert.equal(opened.status, 200);
  const html = await opened.text();
  const id = /name="lumiere-panel" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(id, "the page names its panel for the shim");
  const page = routes.page(id);
  assert.ok(page);
  const socket = fakeSocket();
  page.attach(socket.socket);
  try {
    socket.fromPage({ type: "ready" });
    const load = await until(
      () =>
        socket.received.find(
          (frame) =>
            (frame as { data?: { type?: string } }).data?.type === "load",
        ) as { ch: string; data: { load: number; url: string } } | undefined,
    );
    const bytesUrl = origin + load.data.url;
    const first = await fetch(bytesUrl);
    assert.equal(first.status, 200);
    assert.equal(await first.text(), PDF);

    await rm(pdf);
    if (!(await linkOrSkip(t, outside, pdf))) {
      return;
    }
    const escaped = await fetch(bytesUrl);
    assert.equal(escaped.status, 403);
    assert.equal(await escaped.text(), "");
  } finally {
    socket.close();
  }
});
