/**
 * The extension host's PDFium reads real bookmarks: outline.pdf, whose outline
 * test/fixtures/make-fixtures.mjs describes. The extension loads this engine
 * built as dist/pdf/outline-engine.js; test/vscode/section-links.spec.ts
 * covers that bundle.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createOutlineEngine } from "../../src/extension/outlines/engine";
import { OUTLINE, outlinePdf, shortPdf } from "../fixtures/make-fixtures.mjs";

const wasm = readFileSync(
  createRequire(import.meta.url).resolve(
    "@embedpdf/engine-runtime-wasm32/embedpdf.wasm",
  ),
);

/** RC4, which Node's OpenSSL no longer offers; the encryption of the oldest PDFs. */
function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i]! + key[i % key.length]!) & 255;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let n = 0; n < data.length; n += 1) {
    a = (a + 1) & 255;
    b = (b + state[a]!) & 255;
    [state[a], state[b]] = [state[b]!, state[a]!];
    out[n] = data[n]! ^ state[(state[a]! + state[b]!) & 255]!;
  }
  return out;
}

/**
 * A page that opens only with the user password "secret": a 40-bit RC4
 * standard security handler (V 1, R 2) whose /U entry is computed for it.
 * The page has no strings or streams, so nothing in it needs encrypting.
 */
function passwordProtectedPdf(): Buffer {
  const padding = Buffer.from(
    "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
    "hex",
  );
  const owner = Buffer.alloc(32, 7);
  const id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const key = createHash("md5")
    .update(Buffer.concat([Buffer.from("secret"), padding]).subarray(0, 32))
    .update(owner)
    .update(permissions)
    .update(id)
    .digest()
    .subarray(0, 5);
  const user = rc4(key, padding);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>",
    `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`,
  ];
  let out = "%PDF-1.7\n";
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("the fixture's nested bookmarks come back flat, in order, with 1-based pages", async () => {
  const engine = await createOutlineEngine(wasm);
  try {
    const flat = (items: typeof OUTLINE, depth = 0): unknown[] =>
      items.flatMap((item) => [
        { title: item.title, page: item.page, depth },
        ...flat(item.children, depth + 1),
      ]);
    assert.deepEqual(await engine.sections(outlinePdf()), flat(OUTLINE));
    // The engine keeps working for the next PDF, with or without bookmarks.
    assert.deepEqual(await engine.sections(shortPdf()), []);
    assert.equal((await engine.sections(outlinePdf())).length, 5);
    await assert.rejects(engine.sections(new Uint8Array([1, 2, 3])));
    // A PDF that needs its password opens locked: no sections, not an error.
    assert.deepEqual(await engine.sections(passwordProtectedPdf()), []);
    assert.equal((await engine.sections(outlinePdf())).length, 5);
  } finally {
    await engine.dispose();
  }
});
