import test from "node:test";
import assert from "node:assert/strict";
import {
  keepsBasenameCreate,
  keepsEmbedPdfPageColorsPatch,
} from "../../scripts/bundle-checks.mjs";

test("the basename create path is found in the readable build and the minified one", () => {
  // `pnpm build`, as `pnpm test:vscode` builds it.
  assert.ok(
    keepsBasenameCreate(
      "      create: request2.wiki || mayCreateNote(path13),",
    ),
  );
  // `pnpm package`.
  assert.ok(keepsBasenameCreate("{create:e.wiki||Wt(n)}"));
  assert.ok(keepsBasenameCreate("{create:$e.wiki||Wt(n)}"));
});

test("a build without it is caught", () => {
  assert.equal(keepsBasenameCreate("create: true, wiki: false"), false);
  assert.equal(keepsBasenameCreate(""), false);
});

test("viewer.js keeps EmbedPDF pageColors engines-patch markers (readable and minified)", () => {
  // Readable / development-shaped snippets from the patched engines bundle.
  assert.ok(
    keepsEmbedPdfPageColorsPatch(
      "function resolveEmbedPdfPageColors(pageColors) {\n  background: 0xff1e1e1e,\n  const useColorScheme = colorScheme != null",
    ),
  );
  // Production minify keeps these identifiers (esbuild does not mangle free names used as property/export strings here).
  assert.ok(
    keepsEmbedPdfPageColorsPatch(
      "function resolveEmbedPdfPageColors(n){return{background:0xff1e1e1e}}const useColorScheme=colorScheme!=null",
    ),
  );
});

test("viewer.js without the engines patch is caught", () => {
  // Stock EmbedPDF Matrix-only render path (no ColorScheme / pageColors helper).
  assert.equal(
    keepsEmbedPdfPageColorsPatch(
      "this.pdfiumModule.FPDF_RenderPageBitmapWithMatrix(bitmapPtr,pageCtx.pagePtr",
    ),
    false,
  );
  assert.equal(keepsEmbedPdfPageColorsPatch(""), false);
});
