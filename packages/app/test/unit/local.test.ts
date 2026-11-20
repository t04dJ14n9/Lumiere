import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { MemoryFileSystem, Mounts } from "@workshop/host-web";
import { nodeWorkerLauncher } from "@workshop/markdown/node";
import type { ContributedSetting } from "@workshop/markdown/portable";
import { startLocalHost } from "../../src/local/index";
import type { ServerEvent } from "../../src/shell/api";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const WORKERS = path.join(REPO, "packages/markdown/dist/workers");

function contributed(): ContributedSetting[] {
  const configuration = JSON.parse(
    readFileSync(path.join(REPO, "package.json"), "utf8"),
  ).contributes.configuration as { properties?: Record<string, unknown> }[];
  return configuration.flatMap((section) =>
    Object.entries(section.properties ?? {}).map(([key, schema]) => ({
      key,
      schema: schema as ContributedSetting["schema"],
    })),
  );
}

async function localWindow(t: test.TestContext) {
  const files = new Mounts();
  files.mount(
    "/vaults/Notes",
    new MemoryFileSystem({
      "Welcome.md": "# Welcome\n\nSee [[Other]].",
      "Other.md": "# Other",
      "papers/A.pdf": new Uint8Array([37, 80, 68, 70]),
      "images/a.png": new Uint8Array([1, 2, 3]),
    }),
  );
  const data = new MemoryFileSystem();
  files.mount("/lumiere-data", data);
  const local = await startLocalHost({
    files,
    dataRoot: "/lumiere-data",
    workerUrl: () => "",
    workers: nodeWorkerLauncher(WORKERS),
    contributed: contributed(),
    pages: {
      origin: "https://lumiere.example",
      editor: "https://lumiere.example/markdown/",
      shim: "https://lumiere.example/page/shim.js",
      pdf: {
        viewer: "https://lumiere.example/pdf/",
        shim: "https://lumiere.example/page/pdf-shim.js",
      },
      resource: () => "",
    },
  });
  t.after(() => local.host.stop());
  const events: ServerEvent[] = [];
  local.backend.events((event) => events.push(event));
  return { ...local, data, events };
}

const built = existsSync(WORKERS);

test(
  "the web window opens a mounted folder as a vault and lists its files",
  { skip: !built && "the editor is not built" },
  async (t) => {
    const { backend, data, events } = await localWindow(t);
    await backend.vaults.add("/vaults/Notes");
    assert.deepEqual(await backend.vaults.list(), {
      open: ["/vaults/Notes"],
      recent: ["/vaults/Notes"],
    });
    assert.deepEqual(events[0], {
      type: "vaults",
      open: ["/vaults/Notes"],
      added: "/vaults/Notes",
    });
    assert.deepEqual(await backend.vaults.files("/vaults/Notes"), {
      files: [
        { path: "images/a.png", kind: "image" },
        { path: "Other.md", kind: "note" },
        { path: "papers/A.pdf", kind: "pdf" },
        { path: "Welcome.md", kind: "note" },
      ],
      partial: false,
    });
    await backend.vaults.open("/vaults/Notes/Other.md");
    assert.deepEqual(events.at(-1), {
      type: "open",
      vault: "/vaults/Notes",
      path: "Other.md",
    });
    await assert.rejects(backend.vaults.add("/vaults/Missing"), /Not a folder/);
    assert.deepEqual(
      JSON.parse(
        new TextDecoder().decode(await data.read("window/vaults.json")),
      ),
      ["/vaults/Notes"],
    );
  },
);

test(
  "the web window's layout and settings are kept in the host's data",
  { skip: !built && "the editor is not built" },
  async (t) => {
    const { backend, data } = await localWindow(t);
    assert.equal((await backend.ui.load()).theme, "system");
    assert.equal((await backend.ui.save({ theme: "dark" })).theme, "dark");
    await backend.ui.save({ folders: { "/vaults/Notes": ["Daily"] } });
    const kept = JSON.parse(
      new TextDecoder().decode(await data.read("window/window.json")),
    );
    assert.equal(kept.theme, "dark", "each change keeps the others");
    assert.deepEqual(kept.folders, { "/vaults/Notes": ["Daily"] });
    const items = await backend.settings.list();
    assert.ok(items.length > 50);
    assert.equal(
      items.some((item) => item.key.includes("gitBlame")),
      false,
      "settings of what this host lacks (Git) are left out",
    );
    const changed = await backend.settings.change({
      key: "lumiere.markdown.editor.readableLineLength",
      value: false,
    });
    assert.equal(changed.value, false);
    await assert.rejects(
      backend.settings.change({
        key: "lumiere.markdown.editor.readableLineLength",
        value: "wide",
      }),
    );
  },
);

test(
  "the web window opens a note's page and hands it a channel to its host",
  { skip: !built && "the editor is not built" },
  async (t) => {
    const { backend } = await localWindow(t);
    await backend.vaults.add("/vaults/Notes");
    const page = await backend.editors.open("/vaults/Notes", "Welcome.md");
    assert.match(page.url, /^blob:/);
    const html = await (await fetch(page.url)).text();
    assert.match(html, /lumiere-transport" content="channel"/);
    const port = page.connect?.();
    assert.ok(port, "a page without a server gets a channel");
    port.close();
    page.dispose();
  },
);

test(
  "a PDF opens in a tab in Lumière's PDF viewer, which is handed its bytes",
  { skip: !built && "the editor is not built" },
  async (t) => {
    const { backend } = await localWindow(t);
    await backend.vaults.add("/vaults/Notes");
    assert.deepEqual(backend.editors.kinds, ["note", "pdf"]);
    const page = await backend.editors.open("/vaults/Notes", "papers/A.pdf");
    assert.equal(page.connect, undefined, "a PDF needs no channel to a host");
    const html = await (await fetch(page.url)).text();
    assert.match(html, /viewer\.js/);
    const pdf = /<meta name="lumiere-pdf" content="(blob:[^"]+)">/.exec(
      html,
    )?.[1];
    assert.ok(pdf, "the page names its PDF");
    assert.deepEqual(
      new Uint8Array(await (await fetch(pdf)).arrayBuffer()),
      new Uint8Array([37, 80, 68, 70]),
    );
    page.dispose();
  },
);

test(
  "F36: the web window makes, renames and deletes files, deleting only once confirmed",
  { skip: !built && "the editor is not built" },
  async (t) => {
    const { backend, events } = await localWindow(t);
    await backend.vaults.add("/vaults/Notes");
    await backend.files.createFolder("/vaults/Notes", "archive");
    await backend.files.createNote("/vaults/Notes", "archive/New.md");
    await assert.rejects(
      backend.files.createNote("/vaults/Notes", "archive/New.md"),
    );
    await backend.files.rename("/vaults/Notes", "Other.md", "archive/Other.md");
    assert.deepEqual(events.at(-1), {
      type: "renamed",
      from: "/vaults/Notes/Other.md",
      to: "/vaults/Notes/archive/Other.md",
    });
    // No trash here: nothing goes until the reader confirms.
    assert.deepEqual(
      await backend.files.remove("/vaults/Notes", "archive", {
        permanently: false,
      }),
      { deleted: false, trashed: false },
    );
    assert.deepEqual(
      await backend.files.remove("/vaults/Notes", "archive", {
        permanently: true,
      }),
      { deleted: true, trashed: false },
    );
    const { files } = await backend.vaults.files("/vaults/Notes");
    assert.equal(
      files.some((file) => file.path.startsWith("archive")),
      false,
    );
  },
);
