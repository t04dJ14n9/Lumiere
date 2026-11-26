import assert from "node:assert/strict";
import test from "node:test";
import { createPanel } from "../../../src/plugins/editor/panel";
import { protocol } from "../../../src/plugins/editor/protocol";
import type { PanelShell } from "../../../src/shared/host";
import type {
  Documents,
  DocumentSession,
} from "../../../src/plugins/document/api";
import { COLLAPSED_NOTES_KEY } from "../../../src/shared/properties-collapse";
import { Endpoint } from "../../../src/shared/rpc/endpoint";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

const URI = "file:///notes/a.md";
const TEXT =
  "---\ntitle: A\nstatus: open\n---\n\n# Title\n\nFirst paragraph.\n";

/** A panel for the note, whose workspace storage holds these collapsed notes. */
async function open(collapsed: Record<string, true>) {
  const pages: string[] = [];
  let hostReceive = (_value: unknown) => {};
  let clientReceive = (_value: unknown) => {};
  const client = new Endpoint(
    {
      send: (value) => hostReceive(value),
      listen: (receive) => {
        clientReceive = receive;
        return () => {};
      },
    },
    {
      after(ms, callback) {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      },
    },
  );
  const shell = {
    id: "panel",
    column: undefined,
    document: fakeDocument({ uri: URI, getText: () => TEXT }),
    cspSource: "test",
    trusted: true,
    transport: {
      send: (value: unknown) => clientReceive(value),
      listen: (receive: (value: unknown) => void) => {
        hostReceive = receive;
        return () => {};
      },
    },
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
        text: TEXT,
        version: 1,
        attach: () => () => {},
      }) as unknown as DocumentSession,
    release() {},
  };
  const host = fakeHost({
    settings: {
      get: (_key, fallback) => fallback,
      forNote: () => ({ preset: "obsidian", mode: "livePreview" }),
    },
    storage: {
      get: <T>(key: string, fallback: T) =>
        key === COLLAPSED_NOTES_KEY ? (collapsed as T) : fallback,
      update: async () => {},
    },
  });
  const panel = createPanel(shell, documents, host, {
    onClose() {},
    onState() {},
    configure() {},
  });
  const init = await client.call(protocol, "ready", {});
  await client.dispose();
  await panel.dispose();
  return { html: pages[0]!, init };
}

test("a note whose Properties are stored collapsed gets the heading alone in its snapshot, and says so in ready", async () => {
  const { html, init } = await open({ [URI]: true });
  assert.equal(init.propertiesCollapsed, true);
  assert.match(
    html,
    /properties metadata-container is-collapsed mw-properties-skeleton/,
  );
  assert.equal(
    html.includes("property-row"),
    false,
    "no rows under the heading",
  );
  // The text continues below the sheet: it is exact whatever the rows hold.
  assert.match(html, /First paragraph\./);
  assert.match(html, /isCollapsed&quot;:true/);
});

test("any other note, or a note collapsed elsewhere, is drawn expanded", async () => {
  for (const collapsed of [{}, { "file:///notes/b.md": true as const }]) {
    const { html, init } = await open(collapsed);
    assert.equal(init.propertiesCollapsed, false);
    assert.equal(html.includes("is-collapsed"), false);
    assert.equal((html.match(/class="property-row/g) ?? []).length, 2);
    assert.match(html, /isCollapsed&quot;:false/);
  }
});
