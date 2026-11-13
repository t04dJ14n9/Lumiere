// Focused regression for the PDF engine URL contract in the DSH e2e suite.
//
//   node --test packages/dsh/test/e2e/pdf-engine-url.test.mjs
//
// This is not a live DSH e2e run. It renders HTML the same way
// packages/pdf/src/shared/viewer-page.ts interpolates asset("embedpdf.wasm")
// into data-pdfium-wasm, then checks the e2e predicates against that HTML
// and against the filename copied by packages/markdown/scripts/build.mjs.
// It must reject the historical wrong URL and accept only the shipped path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ENGINE_ATTR,
  SHIPPED_ENGINE_PATH,
  htmlDeclaresShippedEngine,
  isShippedEngineAsset,
} from "./pdf-engine-url.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function readRepo(rel) {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function engineFilenameFromViewerPage(source) {
  const match = source.match(
    /<div id="root" data-pdfium-wasm="\$\{asset\("([^"]+)"\)\}"/,
  );
  assert.ok(
    match,
    "viewer-page.ts root tag must interpolate asset(...) into data-pdfium-wasm",
  );
  return match[1];
}

function renderViewerRoot(asset, engineFilename) {
  return `<div id="root" data-pdfium-wasm="${asset(engineFilename)}"></div>`;
}

function assetFromPdfRoutes(source, name, base = "/lumiere") {
  const match = source.match(
    /asset:\s*\(name\)\s*=>\s*name === "([^"]+)"\s*\?\s*`\$\{base\}\/m\/webview\/([^`]+)`\s*:\s*`\$\{base\}\/pdf\/viewer\/\$\{name\}`/,
  );
  assert.ok(match, "pdf-routes.ts must expose the asset special-case");
  const specialName = match[1];
  return name === specialName
    ? `${base}/m/webview/${match[2]}`
    : `${base}/pdf/viewer/${name}`;
}

function intendedAsset(name, base = "/lumiere") {
  return name === "embedpdf.wasm"
    ? `${base}/m/webview/embedpdf.wasm`
    : `${base}/pdf/viewer/${name}`;
}

const viewerPage = readRepo("packages/pdf/src/shared/viewer-page.ts");
const pdfRoutes = readRepo("packages/host-node/src/host/pdf-routes.ts");
const markdownBuild = readRepo("packages/markdown/scripts/build.mjs");
const engineFilename = engineFilenameFromViewerPage(viewerPage);

describe("PDF engine URL contract used by DSH e2e", () => {
  it("reads the shipped engine filename from viewer-page and the markdown copy", () => {
    assert.equal(engineFilename, "embedpdf.wasm");
    assert.match(
      markdownBuild,
      /@embedpdf\/engine-runtime-wasm32\/embedpdf\.wasm/,
    );
    assert.match(markdownBuild, /dist\/webview\/embedpdf\.wasm/);
    assert.equal(ENGINE_ATTR, "data-pdfium-wasm");
    assert.equal(SHIPPED_ENGINE_PATH, "/lumiere/m/webview/embedpdf.wasm");
  });

  it("rejects the historical wrong HTML URL that the old name-only check accepted", () => {
    const wrongHtml = renderViewerRoot(
      (name) => `/lumiere/pdf/viewer/${name}`,
      engineFilename,
    );
    assert.equal(
      wrongHtml,
      `<div id="root" data-pdfium-wasm="/lumiere/pdf/viewer/embedpdf.wasm"></div>`,
    );
    // The old `html.includes("data-pdfium-wasm")` check would accept this.
    assert.equal(
      htmlDeclaresShippedEngine(wrongHtml),
      false,
      "must reject HTML whose data-pdfium-wasm URL is not the shipped path",
    );
  });

  it("accepts HTML that declares the exact shipped engine URL", () => {
    const okHtml = renderViewerRoot(intendedAsset, engineFilename);
    assert.equal(
      okHtml,
      `<div id="root" data-pdfium-wasm="${SHIPPED_ENGINE_PATH}"></div>`,
    );
    assert.equal(htmlDeclaresShippedEngine(okHtml), true);
  });

  it("treats only the shipped embedpdf.wasm path as the GET target", () => {
    assert.equal(isShippedEngineAsset("/lumiere/m/webview/pdfium.wasm"), false);
    assert.equal(
      isShippedEngineAsset("/lumiere/pdf/viewer/embedpdf.wasm"),
      false,
    );
    assert.equal(isShippedEngineAsset(SHIPPED_ENGINE_PATH), true);
  });

  it("routes the engine through the shipped editor webview path", () => {
    const currentHtml = renderViewerRoot(
      (name) => assetFromPdfRoutes(pdfRoutes, name),
      engineFilename,
    );
    assert.equal(htmlDeclaresShippedEngine(currentHtml), true);
    assert.equal(
      currentHtml,
      `<div id="root" data-pdfium-wasm="${SHIPPED_ENGINE_PATH}"></div>`,
    );
  });
});
