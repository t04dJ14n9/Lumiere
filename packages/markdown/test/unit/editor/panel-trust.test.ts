// S2: a page loaded in Restricted Mode is loaded again once the workspace is
// trusted, so its remote images, media and frames are allowed then.
import assert from "node:assert/strict";
import test from "node:test";
import { createPanel } from "../../../src/plugins/editor/panel";
import type { PanelShell } from "../../../src/shared/host";
import type {
  Documents,
  DocumentSession,
} from "../../../src/plugins/document/api";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

function openPanel(startsTrusted: boolean) {
  const pages: string[] = [];
  const workspace = { trusted: startsTrusted };
  const grants = new Set<() => void>();
  const shell = {
    id: "panel",
    column: undefined,
    document: fakeDocument({ uri: "file:///notes/a.md", getText: () => "" }),
    cspSource: "test",
    get trusted() {
      return workspace.trusted;
    },
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
        text: "",
        version: 1,
        attach: () => () => {},
      }) as unknown as DocumentSession,
    release() {},
  };
  const host = fakeHost({
    workspace: {
      isTrusted: () => workspace.trusted,
      onDidGrantTrust: (listener) => {
        grants.add(listener);
        return () => {
          grants.delete(listener);
        };
      },
    },
  });
  const panel = createPanel(shell, documents, host, {
    onClose() {},
    onState() {},
    configure() {},
  });
  const grant = () => {
    workspace.trusted = true;
    grants.forEach((listener) => listener());
  };
  return { pages, panel, grant, listening: () => grants.size };
}

const allowsRemoteImages = (html: string) => /img-src [^;]*https:/.test(html);

test("a page loaded untrusted is loaded again, with remote content, once trust is granted", async () => {
  const { pages, panel, grant } = openPanel(false);
  assert.equal(pages.length, 1);
  assert.equal(allowsRemoteImages(pages[0]!), false);
  grant();
  assert.equal(pages.length, 2);
  assert.equal(allowsRemoteImages(pages[1]!), true);
  // Trust is granted once; a second event changes nothing.
  grant();
  assert.equal(pages.length, 2);
  await panel.dispose();
});

test("a page loaded trusted is not loaded again, and a closed panel stops listening", async () => {
  const { pages, panel, grant, listening } = openPanel(true);
  grant();
  assert.equal(pages.length, 1);
  assert.equal(allowsRemoteImages(pages[0]!), true);
  await panel.dispose();
  assert.equal(listening(), 0);
});
