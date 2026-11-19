// A PDF opened in a tab is read by WebKit from the app's router, not carried
// over the plugin as base64 and copied again in the window.
import test from "node:test";
import assert from "node:assert/strict";
import { NativeFileSystem } from "../../src/native-fs";

test("a vault file is handed over as the router serves it", async (t) => {
  const asked: string[] = [];
  const pdf = new Uint8Array([37, 80, 68, 70]);
  t.mock.method(globalThis, "fetch", async (url: string) => {
    asked.push(url);
    return new Response(pdf, {
      headers: { "content-type": "application/pdf" },
    });
  });
  const vault = new NativeFileSystem("B1E2", "capacitor://localhost/");
  const blob = await vault.readBlob("Papers/Light and growth.pdf");
  assert.deepEqual(asked, [
    "capacitor://localhost/_lumiere/vault/B1E2/Papers/Light%20and%20growth.pdf",
  ]);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), pdf);
});
