import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { annotationKey, createLocalEngine } from "@embedpdf/engine";
import { clusterPageLinks } from "../../src/shared/page-link-clusters";
import {
  targetPage,
  targetTop,
  targetUrl,
} from "../../src/shared/pdf-link-target";

const wasmPath = createRequire(import.meta.url).resolve(
  "@embedpdf/engine-runtime-wasm32/embedpdf.wasm",
);
const paperPath = "/tmp/paper.pdf";

test("arXiv 2503.20783 page 2: adjacent cite fragments cluster; far repeats do not", async (t) => {
  if (!existsSync(paperPath)) {
    t.skip("Missing /tmp/paper.pdf (arXiv 2503.20783)");
    return;
  }
  const engine = createLocalEngine({
    runtime: { prefer: "wasm", wasmBinary: readFileSync(wasmPath) },
  });
  try {
    const doc = await engine.open({
      kind: "bytes",
      bytes: readFileSync(paperPath),
    });
    const { pages } = await doc.pages.list();
    const pageNumberOf = (ref: { objectNumber: number }) => {
      const index = pages.findIndex(
        (page) => page.ref.objectNumber === ref.objectNumber,
      );
      return index < 0 ? undefined : index + 1;
    };
    const { annotations } = await doc.page(pages[1]!.ref).annotations.list();
    const fragments = annotations.flatMap((annotation) => {
      if (annotation.subtype !== "link") {
        return [];
      }
      const target = {
        page: targetPage(annotation.target, pageNumberOf),
        top: targetTop(annotation.target),
        url: targetUrl(annotation.target),
      };
      return target.page || target.url
        ? [
            {
              id: annotationKey(annotation.ref),
              rect: annotation.rect,
              ...target,
            },
          ]
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
        cluster.segments[0]!.x > 400 &&
        cluster.segments[1]!.x < 150 &&
        cluster.segments[0]!.y > 290 &&
        cluster.segments[0]!.y < 310,
    );
    assert.ok(wrapped, "expected a line-wrapped cite cluster on page 2");
    await doc.close();
  } finally {
    await engine.destroy();
  }
});
