import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { containedResource, createEditorRoutes } from "../../src/host/routes";
import type { LumiereHost } from "../../src/host/start";
import { TreeHub } from "../../src/host/trees";

/**
 * `/lumiere/file` over a real server. Opening the editor first registers its
 * root, as the embedder does, so file requests can be checked against the
 * containment contract: 403 leaves the workspace, 404 is contained but not
 * there.
 */
async function serveFileRoute(t: {
  after(callback: () => void | Promise<void>): void;
}) {
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
  const openEditor = async (note: string, root: string) => {
    host.addRoot(pathToFileURL(root).toString());
    return (
      await fetch(
        `http://127.0.0.1:${port}/lumiere/editor?path=${encodeURIComponent(note)}&root=${encodeURIComponent(root)}`,
      )
    ).status;
  };
  const fileStatus = async (panel: string, uri: string) =>
    (
      await fetch(
        `http://127.0.0.1:${port}/lumiere/file?panel=${encodeURIComponent(panel)}&uri=${encodeURIComponent(uri)}`,
      )
    ).status;
  const fileResponse = (panel: string, uri: string) =>
    fetch(
      `http://127.0.0.1:${port}/lumiere/file?panel=${encodeURIComponent(panel)}&uri=${encodeURIComponent(uri)}`,
    );
  return { openEditor, fileStatus, fileResponse };
}

test("file route: a missing file inside the root is 404", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-inside-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = path.join(scratch, "Note.md");
  await writeFile(note, "# Note");
  const { openEditor, fileStatus } = await serveFileRoute(t);
  assert.equal(await openEditor(note, scratch), 200);
  assert.equal(
    await fileStatus(
      "p1",
      pathToFileURL(path.join(scratch, "missing.md")).toString(),
    ),
    404,
  );
});

test("file route: a missing parent inside the root is 404", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-nested-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = path.join(scratch, "Note.md");
  await writeFile(note, "# Note");
  const { openEditor, fileStatus } = await serveFileRoute(t);
  assert.equal(await openEditor(note, scratch), 200);
  assert.equal(
    await fileStatus(
      "p1",
      pathToFileURL(path.join(scratch, "no-such-dir", "missing.md")).toString(),
    ),
    404,
  );
});

test("file route: absent paths through symlinked ancestors keep their status", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-links-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const vault = path.join(scratch, "vault");
  const outside = path.join(scratch, "outside");
  await mkdir(vault);
  await mkdir(outside);
  const note = path.join(vault, "Note.md");
  await writeFile(note, "# Note");
  const alias = path.join(outside, "vault-link");
  const escape = path.join(vault, "outside-link");
  const dangling = path.join(vault, "dangling-link");
  await symlink(vault, alias);
  await symlink(outside, escape);
  await symlink(path.join(outside, "no-such-dir"), dangling);

  const { openEditor, fileStatus } = await serveFileRoute(t);
  assert.equal(await openEditor(note, vault), 200);
  const status = (file: string) =>
    fileStatus("p1", pathToFileURL(file).toString());
  // A link outside the root that resolves into it stays contained; an
  // escaping or dangling link is refused even when the target is absent.
  assert.equal(await status(path.join(alias, "Note.md")), 200);
  assert.equal(await status(path.join(alias, "missing.md")), 404);
  assert.equal(
    await status(path.join(alias, "no-such-dir", "missing.md")),
    404,
  );
  assert.equal(await status(path.join(escape, "missing.md")), 403);
  assert.equal(
    await status(path.join(escape, "no-such-dir", "missing.md")),
    403,
  );
  assert.equal(await status(path.join(dangling, "missing.md")), 403);
});

test("file route: an existing file inside the root is 200", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-exists-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = path.join(scratch, "Note.md");
  await writeFile(note, "# Note");
  const { openEditor, fileStatus } = await serveFileRoute(t);
  assert.equal(await openEditor(note, scratch), 200);
  assert.equal(await fileStatus("p1", pathToFileURL(note).toString()), 200);
});

test("file route: an existing file outside the root is 403", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-outside-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = path.join(scratch, "Note.md");
  await writeFile(note, "# Note");
  const { openEditor, fileStatus } = await serveFileRoute(t);
  assert.equal(await openEditor(note, scratch), 200);
  assert.equal(
    await fileStatus("p1", pathToFileURL("/etc/hosts").toString()),
    403,
  );
});

test("file route: a request without a registered panel is 403", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-nopanel-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = path.join(scratch, "Note.md");
  await writeFile(note, "# Note");
  const { fileStatus } = await serveFileRoute(t);
  assert.equal(await fileStatus("p1", pathToFileURL(note).toString()), 403);
});

test("file route: a missing parent outside the root is 403", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-outparent-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = path.join(scratch, "Note.md");
  await writeFile(note, "# Note");
  const { openEditor, fileStatus } = await serveFileRoute(t);
  assert.equal(await openEditor(note, scratch), 200);
  // Parent realpath fails; containment must still refuse a path that
  // leaves the workspace, rather than answering 404 as if it were contained.
  assert.equal(
    await fileStatus(
      "p1",
      pathToFileURL("/lumiere-735-no-such-parent/missing.md").toString(),
    ),
    403,
  );
});

test("file route: swapping a final symlink after validation does not serve outside bytes", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-swap-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const vault = path.join(scratch, "vault");
  await mkdir(path.join(vault, "readonly"), { recursive: true });
  const safe = path.join(vault, "readonly", "safe.png");
  const alias = path.join(vault, "image.png");
  const outside = path.join(scratch, "outside.txt");
  const note = path.join(vault, "Note.md");
  await writeFile(safe, "SAFE-735-R1\n");
  await writeFile(outside, "OUTSIDE-735-R1\n");
  await writeFile(note, "# Note");
  await symlink("readonly/safe.png", alias);

  const root = pathToFileURL(vault).toString();
  const resource = await containedResource(
    root,
    pathToFileURL(alias).toString(),
  );
  assert.equal(resource.status, 200);

  // Same window as serveResource: validation has returned a path, then
  // serveFile opens it. Re-point only the original alias, not the safe file.
  await unlink(alias);
  await symlink(outside, alias);

  assert.equal(await readFile(resource.file!, "utf8"), "SAFE-735-R1\n");
  assert.equal(resource.file, await realpath(safe));

  const { openEditor, fileStatus } = await serveFileRoute(t);
  assert.equal(await openEditor(note, vault), 200);
  // A later request must re-validate the new destination and refuse it.
  assert.equal(await fileStatus("p1", pathToFileURL(alias).toString()), 403);
});

test("file route: a vault's files never run as pages or scripts on this origin", async (t) => {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-file-active-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const note = path.join(scratch, "Note.md");
  await writeFile(note, "# Note");
  const files: Record<string, string> = {
    "page.html": "<script>parent.document.title = 'owned'</script>",
    "drawing.svg":
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    "tool.js": "alert(1)",
    "tool.cjs": "alert(1)",
    "image.png": "png",
    "paper.pdf": "%PDF-1.4",
  };
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(scratch, name), body);
  }
  const { openEditor, fileResponse } = await serveFileRoute(t);
  assert.equal(await openEditor(note, scratch), 200);
  const headers = async (name: string) => {
    const response = await fileResponse(
      "p1",
      pathToFileURL(path.join(scratch, name)).toString(),
    );
    assert.equal(response.status, 200, name);
    await response.arrayBuffer();
    return response.headers;
  };
  for (const name of ["page.html", "drawing.svg", "image.png"]) {
    const answer = await headers(name);
    // Opened as a page of its own, it gets an opaque origin, no scripts and
    // nothing to load.
    assert.equal(
      answer.get("content-security-policy"),
      "default-src 'none'; sandbox",
      name,
    );
    assert.equal(answer.get("x-content-type-options"), "nosniff", name);
  }
  assert.equal(
    (await headers("drawing.svg")).get("content-type"),
    "image/svg+xml",
  );
  assert.equal((await headers("image.png")).get("content-type"), "image/png");
  for (const name of ["page.html", "tool.js", "tool.cjs"]) {
    const answer = await headers(name);
    // Neither rendered nor run: bytes, which a browser saves when opened.
    assert.equal(answer.get("content-type"), "application/octet-stream", name);
    assert.equal(answer.get("content-disposition"), "attachment", name);
    assert.equal(answer.get("x-content-type-options"), "nosniff", name);
  }
  // Chrome refuses to show a PDF in a sandboxed document; its viewer runs on
  // its own origin, not this one.
  const pdf = await headers("paper.pdf");
  assert.equal(pdf.get("content-type"), "application/pdf");
  assert.equal(pdf.get("content-security-policy"), null);
});
