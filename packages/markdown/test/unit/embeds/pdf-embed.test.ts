import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import {
  formatPdfOpenTarget,
  parsePdfEmbedSubpath,
  pdfFilename,
  renderPdfPageFromBytes,
} from "../../../src/plugins/embeds/pdf-embed";

const require = createRequire(import.meta.url);

test("parsePdfEmbedSubpath parses #page=N, #height=H, and #page=N&height=H", () => {
  assert.deepEqual(parsePdfEmbedSubpath("document.pdf"), { page: 1 });
  assert.deepEqual(parsePdfEmbedSubpath("document.pdf#page=3"), { page: 3 });
  assert.deepEqual(parsePdfEmbedSubpath("document.pdf#height=400"), {
    page: 1,
    height: 400,
  });
  assert.deepEqual(parsePdfEmbedSubpath("document.pdf#page=3&height=400"), {
    page: 3,
    height: 400,
  });
  assert.deepEqual(
    parsePdfEmbedSubpath("folder/doc.pdf#height=320&page=4|Alias"),
    {
      page: 4,
      height: 320,
    },
  );
  assert.deepEqual(parsePdfEmbedSubpath("document.pdf", 360), {
    page: 1,
    height: 360,
  });
  assert.deepEqual(parsePdfEmbedSubpath("document.pdf#page=0&height=-10"), {
    page: 1,
  });
});

test("formatPdfOpenTarget and pdfFilename format viewer open targets and display names", () => {
  assert.equal(
    formatPdfOpenTarget("attachments/paper.pdf", 1),
    "attachments/paper.pdf#page=1",
  );
  assert.equal(
    formatPdfOpenTarget("attachments/paper.pdf#page=3&height=400", 3),
    "attachments/paper.pdf#page=3",
  );
  assert.equal(
    formatPdfOpenTarget("attachments/paper.pdf#height=400|Paper", 5),
    "attachments/paper.pdf#page=5",
  );
  assert.equal(
    pdfFilename("attachments/my%20paper.pdf#page=2&height=400"),
    "my paper.pdf",
  );
});

const wasmBuffer = readFileSync(
  require.resolve("@embedpdf/engine-runtime-wasm32/embedpdf.wasm"),
);
const wasmArrayBuffer = wasmBuffer.buffer.slice(
  wasmBuffer.byteOffset,
  wasmBuffer.byteOffset + wasmBuffer.byteLength,
);

test("renderPdfPageFromBytes renders PDF pages via EmbedPDF's engine", async () => {
  const samplePdf = new Uint8Array(
    readFileSync(path.resolve("test/fixtures/vault/attachments/sample.pdf")),
  );

  const rendered = await renderPdfPageFromBytes(
    samplePdf,
    1,
    600,
    wasmArrayBuffer,
  );
  assert.equal(rendered.pageCount, 1);
  assert.equal(rendered.page, 1);
  assert.ok(rendered.width >= 600);
  assert.ok(rendered.height > 0);
  assert.equal(rendered.rgba.length, rendered.width * rendered.height * 4);

  const clamped = await renderPdfPageFromBytes(
    samplePdf,
    5,
    600,
    wasmArrayBuffer,
  );
  assert.equal(clamped.page, 1);
});

/** A one-page PDF of `width` x `height` points that the file turns by `rotate` degrees. */
function turnedPdf(width: number, height: number, rotate: number): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Rotate ${rotate} >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  const entries = offsets.map(
    (offset) => `${String(offset).padStart(10, "0")} 00000 n \n`,
  );
  out += `xref\n0 4\n0000000000 65535 f \n${entries.join("")}`;
  out += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("renderPdfPageFromBytes draws a turned page the way a viewer shows it", async () => {
  // 300 x 400 points, turned a quarter: it shows 400 wide and 300 tall.
  const turned = await renderPdfPageFromBytes(
    turnedPdf(300, 400, 90),
    1,
    400,
    wasmArrayBuffer,
  );
  assert.equal(turned.width, 400);
  assert.equal(turned.height, 300);
  const upright = await renderPdfPageFromBytes(
    turnedPdf(300, 400, 0),
    1,
    600,
    wasmArrayBuffer,
  );
  assert.equal(upright.width, 600);
  assert.equal(upright.height, 800);
});

test("renderPdfPageFromBytes rejects bytes that are not a PDF, and keeps working", async () => {
  await assert.rejects(
    renderPdfPageFromBytes(new Uint8Array([1, 2, 3]), 1, 600, wasmArrayBuffer),
  );
  const rendered = await renderPdfPageFromBytes(
    turnedPdf(300, 400, 0),
    1,
    300,
    wasmArrayBuffer,
  );
  assert.equal(rendered.width, 300);
});
