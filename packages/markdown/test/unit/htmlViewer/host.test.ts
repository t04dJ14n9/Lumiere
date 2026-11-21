import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { viewerPolicy } from "../../../src/plugins/htmlViewer/document";
import {
  htmlViewerHost,
  MAX_HTML_BYTES,
} from "../../../src/plugins/htmlViewer/host";
import { provideHostServices } from "../../../src/shared/host";
import type { LumierePanel, PanelOptions } from "../../../src/shared/host";
import { contributionId } from "../../../src/shared/setting-schema";
import { fakeHost } from "../../support/vscode-fake";

const OPEN = contributionId("htmlViewer.open");
const ROOT = "file:///home/reader/vault";
const FILE = `${ROOT}/wiki/assets/diagram.html`;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Opened {
  viewType: string;
  title: string;
  options: PanelOptions | undefined;
  html: string[];
}

/** The plugin over a workspace with `folders`, trusted or not, and `stat` as given. */
async function viewer(
  setup: {
    trusted?: boolean;
    folders?: string[];
    stat?: (uri: string) => { mtime: number; symbolicLink: boolean };
    realContains?: (root: string, uri: string) => boolean;
    /** The file's bytes, by URI; the default is a small page. */
    read?: (uri: string) => Uint8Array;
  } = {},
) {
  const opened: Opened[] = [];
  const executed: unknown[][] = [];
  const errors: string[] = [];
  const stats: string[] = [];
  const reads: string[] = [];
  let command: ((...args: unknown[]) => unknown) | undefined;
  const panel = (
    viewType: string,
    title: string,
    options?: PanelOptions,
  ): LumierePanel => {
    const record: Opened = { viewType, title, options, html: [] };
    opened.push(record);
    return {
      reveal() {},
      setTitle() {},
      visible: true,
      onDidChangeVisibility: () => () => {},
      onDispose: () => () => {},
      dispose() {},
      webview: {
        cspSource: "https://*.vscode-cdn.net",
        asset: (relative) => relative,
        resource: (uri) =>
          `https://file%2B.vscode-resource.vscode-cdn.net${new URL(uri).pathname}`,
        setHTML: (html) => record.html.push(html),
        post() {
          throw new Error("The viewer never posts to its page");
        },
        onMessage() {
          throw new Error("The viewer never listens to its page");
        },
      },
    };
  };
  const realContains = setup.realContains;
  const host = fakeHost({
    hostCommands: {
      register(id, run) {
        if (id === OPEN) {
          command = run;
        }
        return () => {};
      },
      async execute(...args: unknown[]) {
        executed.push(args);
        return undefined;
      },
    },
    views: { panel },
    dialogs: { error: (message) => errors.push(message) },
    workspace: {
      isTrusted: () => setup.trusted ?? true,
      folders: () => setup.folders ?? [ROOT],
      async read(uri: string) {
        reads.push(uri);
        return (
          setup.read?.(uri) ??
          new TextEncoder().encode(
            "<!doctype html><html><head><title>T</title></head><body>Hi</body></html>",
          )
        );
      },
      async stat(uri: string) {
        stats.push(uri);
        return setup.stat?.(uri) ?? { mtime: 7, symbolicLink: false };
      },
      ...(realContains
        ? {
            realContains: async (root: string, uri: string) =>
              realContains(root, uri),
          }
        : {}),
    },
  });
  const root = createRoot({ logger: { debug() {}, warn() {}, error() {} } });
  provideHostServices(root, host);
  root.plugin(htmlViewerHost);
  await root.settled();
  return {
    opened,
    executed,
    errors,
    stats,
    reads,
    async open(...args: unknown[]): Promise<void> {
      assert.ok(command, "the plugin registered its command");
      await command(...args);
      await tick();
      await tick();
    },
  };
}

test("a trusted workspace shows the file as the panel's own page, with its folder as the base", async () => {
  const v = await viewer();
  await v.open(FILE, ROOT, { viewColumn: 2 });
  assert.equal(v.opened.length, 1);
  const panel = v.opened[0]!;
  assert.equal(panel.viewType, contributionId("htmlViewer"));
  assert.equal(panel.title, "diagram.html");
  assert.deepEqual(panel.options, {
    key: FILE,
    resourceRoots: [ROOT],
    retainContext: true,
    column: 2,
  });
  assert.deepEqual(v.reads, [FILE]);
  assert.equal(panel.html.length, 1);
  const html = panel.html[0]!;
  // The file is the document: its own markup, with a policy and a base in its head.
  assert.match(
    html,
    /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; /,
  );
  assert.ok(html.includes("<title>T</title></head><body>Hi</body></html>"));
  assert.ok(
    html.includes(
      '<base href="https://file%2B.vscode-resource.vscode-cdn.net/home/reader/vault/wiki/assets/">',
    ),
    "the base is the webview address of the file's folder",
  );
  assert.ok(
    html.includes(`content="${viewerPolicy("https://*.vscode-cdn.net")}"`),
  );
  // No frame, in any form: the page is not in a child document.
  assert.doesNotMatch(html, /<iframe|srcdoc|sandbox/i);
  assert.deepEqual(v.executed, []);
  assert.deepEqual(v.errors, []);
});

test("a file in the vault's own folder has the vault as its base", async () => {
  const v = await viewer();
  await v.open(`${ROOT}/top.html`, ROOT);
  assert.ok(
    v.opened[0]!.html[0]!.includes(
      '<base href="https://file%2B.vscode-resource.vscode-cdn.net/home/reader/vault/">',
    ),
  );
});

test("the host listens to nothing from the page and sends it nothing", async () => {
  // The fake panel throws if the plugin registers a message handler or posts:
  // opening, and opening again, must do neither.
  const v = await viewer();
  await v.open(FILE, ROOT);
  await v.open(FILE, ROOT);
  assert.equal(v.opened.length, 2);
  assert.deepEqual(v.errors, []);
});

test("opening the file again loads it again", async () => {
  const bytes = { text: "<p>one</p>" };
  const v = await viewer({ read: () => new TextEncoder().encode(bytes.text) });
  await v.open(FILE, ROOT);
  await new Promise((resolve) => setTimeout(resolve, 2));
  bytes.text = "<p>two</p>";
  await v.open(FILE, ROOT);
  const [first, second] = [v.opened[0]!.html[0]!, v.opened[1]!.html[0]!];
  assert.ok(first.includes("<p>one</p>") && second.includes("<p>two</p>"));
  assert.notEqual(first, second);
});

test("the file is read as UTF-8 text, a byte order mark dropped", async () => {
  const bytes = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode("<html><head></head><body>é 图</body></html>"),
  ]);
  const v = await viewer({ read: () => bytes });
  await v.open(FILE, ROOT);
  const html = v.opened[0]!.html[0]!;
  assert.ok(html.startsWith("<html><head><meta"));
  assert.ok(html.includes("é 图"));
});

test("a file too large to set as a page is refused", async () => {
  const v = await viewer({ read: () => new Uint8Array(MAX_HTML_BYTES + 1) });
  await v.open(FILE, ROOT);
  assert.deepEqual(v.opened, []);
  assert.equal(v.errors.length, 1);
});

test("the tab may load the vault's files and no others", async () => {
  const v = await viewer();
  await v.open(FILE, ROOT);
  assert.deepEqual(v.opened[0]!.options?.resourceRoots, [ROOT]);
  assert.equal("column" in v.opened[0]!.options!, false);
});

test("in Restricted Mode the file opens as text and no page is ever made", async () => {
  const v = await viewer({ trusted: false });
  await v.open(FILE, ROOT, { viewColumn: 1 });
  assert.deepEqual(v.opened, []);
  assert.deepEqual(v.executed, [["vscode.open", FILE]]);
  // Nothing was read, so nothing of the page reached an editor of ours.
  assert.deepEqual(v.stats, []);
  assert.deepEqual(v.reads, []);
});

test("a file outside the vault is refused, in no panel and in no editor", async () => {
  const v = await viewer();
  for (const outside of [
    "file:///home/reader/secret.html",
    "file:///home/reader/vault-other/a.html",
    `${ROOT}/../secret.html`,
    "vscode-remote://host/vault/a.html",
  ]) {
    await v.open(outside, ROOT);
  }
  assert.deepEqual(v.opened, []);
  assert.deepEqual(v.executed, []);
  assert.equal(v.errors.length, 4);
  assert.deepEqual(
    v.stats,
    [],
    "nothing outside the vault was asked of the disk",
  );
  assert.deepEqual(v.reads, [], "nor read");
});

test("a vault outside the workspace is refused, however the command was called", async () => {
  const v = await viewer();
  await v.open("file:///etc/page.html", "file:///etc");
  assert.deepEqual(v.opened, []);
  assert.deepEqual(v.reads, []);
  assert.equal(v.errors.length, 1);
  // Without a workspace folder the vault is the note's own folder, and stands.
  const loose = await viewer({ folders: [] });
  await loose.open(FILE, ROOT);
  assert.equal(loose.opened.length, 1);
});

test("a symbolic link is refused where the host resolves none, and by its real path where it does", async () => {
  const linked = await viewer({
    stat: () => ({ mtime: 1, symbolicLink: true }),
    folders: ["vscode-remote://host/vault"],
  });
  await linked.open(
    "vscode-remote://host/vault/linked.html",
    "vscode-remote://host/vault",
  );
  assert.deepEqual(linked.opened, []);
  assert.deepEqual(linked.reads, [], "a refused file is never read");

  const escaping = await viewer({
    realContains: (_root, uri) => !uri.endsWith("escape.html"),
  });
  await escaping.open(`${ROOT}/escape.html`, ROOT);
  assert.deepEqual(escaping.opened, []);
  assert.deepEqual(escaping.reads, []);
  assert.equal(escaping.errors.length, 1);
  await escaping.open(FILE, ROOT);
  assert.equal(escaping.opened.length, 1);
});

test("what is not an HTML file in a vault is ignored: no panel, no editor, no dialog", async () => {
  const v = await viewer();
  await v.open(`${ROOT}/notes/a.md`, ROOT);
  await v.open(FILE, 42);
  await v.open();
  await v.open(FILE, ROOT, { viewColumn: 99 });
  assert.deepEqual(v.opened, []);
  assert.deepEqual(v.executed, []);
  assert.deepEqual(v.errors, []);
});

test("one panel per file: the same file asks for the same key", async () => {
  const v = await viewer();
  await v.open(FILE, ROOT);
  await v.open(FILE, ROOT);
  await v.open(`${ROOT}/other.html`, ROOT);
  assert.deepEqual(
    v.opened.map((panel) => panel.options?.key),
    [FILE, FILE, `${ROOT}/other.html`],
  );
});
