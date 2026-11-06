import assert from "node:assert/strict";
import test from "node:test";
import type { Logger } from "@workshop/core";
import { createPanel } from "../../../src/plugins/editor/panel";
import type { NoteSettings, PanelShell } from "../../../src/shared/host";
import type {
  Documents,
  DocumentSession,
} from "../../../src/plugins/document/api";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

const TEXT = "# Title\n\nFirst paragraph.\n";
const NOTE: NoteSettings = { preset: "obsidian", mode: "livePreview" };

/** The HTML the host sets for a note opened with these settings. */
async function pageFor(
  options: {
    note?: () => NoteSettings;
    isOn?: boolean;
    opening?: PanelShell["openingSelection"];
  } = {},
) {
  const pages: string[] = [];
  const warnings: unknown[][] = [];
  let reads = 0;
  const shell = {
    id: "panel",
    column: undefined,
    document: fakeDocument({ uri: "file:///notes/a.md", getText: () => TEXT }),
    cspSource: "test",
    trusted: true,
    ...(options.opening ? { openingSelection: options.opening } : {}),
    transport: { send() {}, listen: () => () => {} },
    active: () => true,
    reveal() {},
    dispose() {},
    setHTML: (html: string) => pages.push(html),
    asset: (path: string) => `asset:${path}`,
    resource: (target: string) => target,
    onDispose: () => () => {},
    onState: () => () => {},
  } as unknown as PanelShell;
  const documents: Documents = {
    session: () =>
      ({
        get text() {
          reads++;
          return TEXT;
        },
        version: 1,
        attach: () => () => {},
      }) as unknown as DocumentSession,
    release() {},
  };
  const host = fakeHost({
    settings: {
      get: (key, fallback) =>
        key === "editor.firstPaintSnapshot"
          ? ((options.isOn ?? true) as typeof fallback)
          : fallback,
      forNote: options.note ?? (() => NOTE),
    },
  });
  const logger = { warn: (...args: unknown[]) => warnings.push(args) };
  const panel = createPanel(shell, documents, host, {
    onClose() {},
    onState() {},
    configure() {},
    logger: logger as unknown as Logger,
  });
  await panel.dispose();
  return { html: pages[0]!, warnings, reads: () => reads };
}

test("a note's page carries its first screen and loads the editor by import()", async () => {
  const { html } = await pageFor();
  assert.match(html, /<main id="app"[^>]*><div class="mw-snapshot"/);
  assert.match(html, /First paragraph\./);
  assert.match(html, /import\("asset:webview\/editor.js"\)/);
  assert.equal(html.includes('type="module"'), false);
});

test("with the setting off the page is as before, and the note is not read for it", async () => {
  const { html, reads } = await pageFor({ isOn: false });
  assert.equal(html.includes("mw-snapshot"), false);
  assert.match(
    html,
    /<script type="module" nonce="[^"]+" src="asset:webview\/editor.js">/,
  );
  assert.equal(reads(), 0);
});

test("a note that opens elsewhere than its top has no snapshot", async () => {
  for (const opening of [
    { anchor: 12, head: 20 },
    { anchor: 0, head: 0, topLine: 40 },
  ]) {
    const { html } = await pageFor({ opening });
    assert.equal(html.includes("mw-snapshot"), false, JSON.stringify(opening));
  }
  // VS Code reports the top when it opens a note: nothing to skip.
  const top = await pageFor({ opening: { anchor: 0, head: 0, topLine: 0 } });
  assert.match(top.html, /mw-snapshot/);
});

test("settings the snapshot cannot match give the page as before", async () => {
  const { html } = await pageFor({
    note: () => ({ preset: "obsidian", mode: "source" }),
  });
  assert.equal(html.includes("mw-snapshot"), false);
});

test("a failure drawing it is logged and the note still opens", async () => {
  const { html, warnings } = await pageFor({
    note: () => {
      throw new Error("settings unavailable");
    },
  });
  assert.equal(html.includes("mw-snapshot"), false);
  assert.match(html, /<script type="module"/);
  assert.equal(warnings.length, 1);
});
