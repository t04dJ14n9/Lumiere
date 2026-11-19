import test from "node:test";
import assert from "node:assert/strict";
import { openExternalLink } from "../../../src/host/external-link";

// Parsing it into a Uri would decode %2F, %26 and %3D, and VS Code would
// open a different URL; the string goes through as written.
test("a web link opens exactly as written, percent-encoding included", async () => {
  const opened: unknown[] = [];
  const env = {
    openExternal: async (target: unknown) => {
      opened.push(target);
      return true;
    },
  } as Parameters<typeof openExternalLink>[0];
  const href = "https://example.com/a%2Fb?next=%2Fhome%3Fx%3D1%26y%3D2#top";

  assert.equal(await openExternalLink(env, href), true);
  assert.deepEqual(opened, [href]);
});
