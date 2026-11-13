import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createEditorRoutes } from "../../src/host/routes";
import type { LumiereHost } from "../../src/host/start";
import { TreeHub } from "../../src/host/trees";

const INSIDE = "INSIDE_722_SYMLINK";
const OUTSIDE = "OUTSIDE_722_ESCAPE";
const UNSUPPORTED_SYMLINKS = new Set([
  "EACCES",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
  "ERROR_PRIVILEGE_NOT_HELD",
]);

/** `/lumiere/file` over a real server, with the panel root registered by the embedder first. */
async function serveFileRoute(t: test.TestContext) {
  const roots = new Set<string>();
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
  const base = `http://127.0.0.1:${port}/lumiere`;
  return {
    openEditor: (note: string, root: string) => {
      host.addRoot(pathToFileURL(root).toString());
      return fetch(
        `${base}/editor?path=${encodeURIComponent(note)}&root=${encodeURIComponent(root)}`,
      );
    },
    getFile: (uri: string) =>
      fetch(`${base}/file?panel=p1&uri=${encodeURIComponent(uri)}`),
  };
}

/** A symlink, or a skipped test where this platform does not grant symlinks. */
async function link(
  t: test.TestContext,
  target: string,
  alias: string,
  type: "dir" | "file",
): Promise<boolean> {
  try {
    await symlink(target, alias, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (UNSUPPORTED_SYMLINKS.has(code)) {
      t.skip(`creating symlinks is not supported (${code})`);
      return false;
    }
    throw error;
  }
}

async function workspace(t: test.TestContext, prefix: string) {
  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const vault = path.join(scratch, "vault");
  await mkdir(vault);
  const note = path.join(vault, "Note.md");
  await writeFile(note, "# Note");
  return { scratch, vault, note };
}

test("file route: symlinked ancestors that stay in the workspace serve the file", async (t) => {
  const { scratch, vault, note } = await workspace(t, "lumiere-file-symlink-");
  const assets = path.join(vault, "assets");
  await mkdir(assets);
  await writeFile(path.join(assets, "image.png"), INSIDE);
  const images = path.join(vault, "images");
  const workspaceAlias = path.join(scratch, "workspace-alias");
  // One alias is inside the root; the other spells the root through a sibling
  // symlink, so the request is not lexically under the registered real root.
  if (!(await link(t, assets, images, "dir"))) {
    return;
  }
  if (!(await link(t, vault, workspaceAlias, "dir"))) {
    return;
  }

  const { openEditor, getFile } = await serveFileRoute(t);
  assert.equal((await openEditor(note, vault)).status, 200);
  for (const file of [
    path.join(images, "image.png"),
    path.join(workspaceAlias, "assets", "image.png"),
  ]) {
    const response = await getFile(pathToFileURL(file).toString());
    assert.equal(response.status, 200, file);
    assert.equal(await response.text(), INSIDE);
  }
});

test("file route: an escaping symlink is strictly 403", async (t) => {
  const { scratch, vault, note } = await workspace(t, "lumiere-file-escape-");
  const outside = path.join(scratch, "outside.png");
  await writeFile(outside, OUTSIDE);
  const escape = path.join(vault, "escape.png");
  if (!(await link(t, outside, escape, "file"))) {
    return;
  }

  const { openEditor, getFile } = await serveFileRoute(t);
  assert.equal((await openEditor(note, vault)).status, 200);
  const response = await getFile(pathToFileURL(escape).toString());
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes(OUTSIDE), false);
});
