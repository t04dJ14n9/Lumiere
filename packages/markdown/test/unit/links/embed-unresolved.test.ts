import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@workshop/core";
import { registerEmbedUnresolved } from "../../../src/plugins/links/webview";

/** A rendered anchor with just what tagUnresolvedAnchors reads and writes. */
function anchor(href: string) {
  const classes = new Set<string>();
  return {
    getAttribute: (name: string) => (name === "href" ? href : null),
    classList: {
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, force: boolean) =>
        force ? classes.add(name) : classes.delete(name),
    },
    classes,
  };
}

test("an embed holding only Markdown links is still dimmed where they miss", async () => {
  let postProcess: ((pass: unknown) => void) | undefined;
  const requests: unknown[] = [];
  const ctx = {
    on: (_event: string, handler: (pass: unknown) => void) => {
      postProcess = handler;
    },
    rpc: {
      call: async (_protocol: unknown, _method: string, params: unknown) => {
        requests.push(params);
        return ["missing"];
      },
    },
    isLive: true,
    logger: { warn: () => {} },
  } as unknown as Context;
  registerEmbedUnresolved(ctx, new Map());
  const missing = anchor("Missing.md");
  const here = anchor("Here.md");
  // No `a[data-wiki]` in the embed: Markdown links only.
  const container = {
    isConnected: true,
    querySelectorAll: (selector: string) =>
      selector === "a[href]" ? [missing, here] : [],
  };
  postProcess?.({ container, documentUri: "memory:///vault/Embedded.md" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [{ source: "memory:///vault/Embedded.md" }]);
  assert.equal(missing.classes.has("is-unresolved"), true);
  assert.equal(here.classes.has("is-unresolved"), false);
});
