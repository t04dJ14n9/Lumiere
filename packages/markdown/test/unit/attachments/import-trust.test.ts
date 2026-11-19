import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { attachmentsHost } from "../../../src/plugins/attachments/host";
import { provideHostServices } from "../../../src/shared/host";
import { fakeHost } from "../../support/vscode-fake";
import { memoryVaults, uriOf } from "../views/fakes";

type Handler = (params: { url: string }) => Promise<{ ok: boolean }>;

/** The attachments host answering one note page, in a workspace of that trust. */
async function notePage(trusted: boolean) {
  const handlers = new Map<string, Handler>();
  const errors: string[] = [];
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    throw new Error("offline");
  }) as typeof fetch;
  const root = createRoot();
  provideHostServices(
    root,
    fakeHost({
      workspace: { isTrusted: () => trusted },
      dialogs: { error: (message) => errors.push(message) },
    }),
  );
  const panel = {
    id: "panel-1",
    document: { uri: uriOf("A.md") },
    rpc: {
      handle(_protocol: unknown, method: string, run: Handler) {
        handlers.set(method, run);
        return () => handlers.delete(method);
      },
      on: () => () => {},
    },
  };
  root.provide("vaults", memoryVaults({ "A.md": "" }).vaults);
  root.provide("editors", {
    all: () => [panel],
    active: () => panel,
  } as never);
  root.plugin(attachmentsHost);
  await root.settled();
  return {
    importUrl: (url: string) => handlers.get("importUrl")!({ url }),
    errors,
    fetched,
    async dispose() {
      globalThis.fetch = realFetch;
      await root.dispose();
    },
  };
}

test("in an untrusted workspace a note page cannot make the host download", async () => {
  const page = await notePage(false);
  const result = await page.importUrl("https://example.com/cat.png");
  assert.equal(result.ok, false);
  assert.deepEqual(page.fetched, []);
  assert.match(page.errors[0] ?? "", /trusted workspace/);
  await page.dispose();
});

test("in a trusted workspace the host downloads a page's image", async () => {
  const page = await notePage(true);
  const result = await page.importUrl("https://example.com/cat.png");
  // The fake network is offline; the request was made.
  assert.equal(result.ok, false);
  assert.equal(page.fetched.length, 1);
  await page.dispose();
});
