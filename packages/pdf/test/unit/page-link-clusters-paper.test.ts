import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-direct-engine";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { clusterPageLinks } from "../../src/shared/page-link-clusters";
import {
  targetPage,
  targetTop,
  targetUrl,
} from "../../src/webview/pdf-targets";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wasmPath = path.join(
  root,
  "node_modules/@embedpdf/pdfium/dist/pdfium.wasm",
);
const paperPath = "/tmp/paper.pdf";

test("arXiv 2503.20783 page 2: adjacent cite fragments cluster; far repeats do not", async (t) => {
  if (!existsSync(paperPath)) {
    t.skip("Missing /tmp/paper.pdf (arXiv 2503.20783)");
    return;
  }
  const wasm = readFileSync(wasmPath);
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/wasm");
    res.end(wasm);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    const engine = await createPdfiumEngine(
      `http://127.0.0.1:${port}/pdfium.wasm`,
      { fontFallback: null },
    );
    const bytes = readFileSync(paperPath);
    const content = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const doc = await engine
      .openDocumentBuffer({ id: "paper", content })
      .toPromise();
    const page = doc.pages[1]!;
    const annotations = await engine.getPageAnnotations(doc, page).toPromise();
    const fragments = annotations.flatMap((annotation) => {
      if (annotation.type !== PdfAnnotationSubtype.LINK) {
        return [];
      }
      const target = {
        page: targetPage(annotation.target),
        top: targetTop(annotation.target, doc),
        url: targetUrl(annotation.target),
      };
      return target.page || target.url
        ? [{ id: annotation.id, rect: annotation.rect, ...target }]
        : [];
    });
    assert.ok(
      fragments.length >= 20,
      `expected many links, got ${fragments.length}`,
    );
    const clusters = clusterPageLinks(fragments);
    const multi = clusters.filter((cluster) => cluster.segments.length >= 2);
    assert.ok(
      multi.length >= 5,
      `expected several multi-segment cites, got ${multi.length}`,
    );

    // Dest that appears as four fragments (two cites far apart) → two clusters.
    const byDest = new Map<string, typeof fragments>();
    for (const fragment of fragments) {
      const key = fragment.url
        ? `url:${fragment.url}`
        : `page:${fragment.page}:${fragment.top ?? ""}`;
      const list = byDest.get(key) ?? [];
      list.push(fragment);
      byDest.set(key, list);
    }
    const fourFragmentDest = [...byDest.values()].find(
      (group) => group.length === 4,
    );
    assert.ok(fourFragmentDest, "expected a destination with four fragments");
    const fourIds = new Set(fourFragmentDest.map((fragment) => fragment.id));
    const matching = clusters.filter((cluster) =>
      cluster.segmentIds.every((id) => fourIds.has(id)),
    );
    assert.equal(
      matching.length,
      2,
      `far-apart same dest should be 2 clusters, got ${matching.length}`,
    );
    assert.ok(matching.every((cluster) => cluster.segments.length === 2));

    const wrapped = clusters.find(
      (cluster) =>
        cluster.segments.length === 2 &&
        cluster.segments[0]!.origin.x > 400 &&
        cluster.segments[1]!.origin.x < 150 &&
        cluster.segments[0]!.origin.y > 290 &&
        cluster.segments[0]!.origin.y < 310,
    );
    assert.ok(wrapped, "expected a line-wrapped cite cluster on page 2");
    await engine.closeDocument(doc).toPromise();
  } finally {
    server.close();
  }
});
