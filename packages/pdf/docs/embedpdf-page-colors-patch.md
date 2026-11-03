# EmbedPDF `pageColors` engines patch

Lumia dark paper depends on a **`pnpm patch`** of `@embedpdf/engines@2.15.1`
(and a small `@embedpdf/models@2.15.1` types patch). Upstream
[embedpdf/embed-pdf-viewer#679](https://github.com/embedpdf/embed-pdf-viewer/issues/679)
is still open; PDFium WASM already exports
`FPDF_RenderPageBitmapWithColorScheme_Start`, but stock engines JS only calls
`FPDF_RenderPageBitmapWithMatrix`.

## What the engines patch does

- Accepts `pageColors` on `PdfRenderPageOptions` (object or `'dark'` / `'normal'`).
- On **full-page** renders when color-scheme colors are present **and**
  `FPDF_RenderPageBitmapWithColorScheme_Start` is available (`useColorScheme`):
  - Prefills the bitmap with `pageColors.background` **only on that path**
    (same gate as ColorScheme Start — never dark-fill then Matrix).
  - Calls `FPDF_RenderPageBitmapWithColorScheme_Start` + `Continue` / `Close`
    with an `FPDF_COLORSCHEME` (path/text fill and stroke).
  - Optionally sets `FPDF_CONVERT_FILL_TO_STROKE` when `convertFillToStroke` is true.
- **Partial rect** / annotation bitmaps, or missing ColorScheme Start: soft-fail to
  **Normal** Matrix with the default white / transparent fill (v1).
- Covers both `pdfium-direct-engine` and `pdfium-worker-engine` bundles.

Patch files:

- `patches/@embedpdf__engines@2.15.1.patch`
- `patches/@embedpdf__models@2.15.1.patch` (`pageColors` on `PdfRenderPageOptions`)

Declared in `pnpm-workspace.yaml` → `patchedDependencies`.

## Lumia wiring

- `PAGE_COLORS_ENGINE_AVAILABLE = true` in
  `packages/pdf/src/shared/page-colors-engine.ts`.
- On dark paper `packages/pdf/src/webview/page-bitmaps.tsx` does not show the
  color-scheme render. PDFium's color scheme paints every filled shape one
  colour and all text one colour, so a node box and its label came out the
  same colour (the label vanished) and the bars of a chart all turned the
  same. Each page is rendered twice (`src/webview/dark-render.ts`): as
  authored, and with the color scheme on a **transparent** background and
  ink of alpha 1 (`FORCED_PAGE_COLORS`). The scheme leaves pictures alone, so
  the only opaque pixels of the second render are pictures. `darkenPage`
  (`src/shared/dark-page.ts`) inverts the lightness of every other pixel of
  the first render, keeping hue (the matrix of CSS
  `invert(1) hue-rotate(180deg)`, laid between the dark paper `#1e1e1e` and
  the ink `#e8e6e3`) and leaves pictures as authored. Alpha, not a colour
  comparison, finds the pictures: a light grey fill is close to the ink's
  colour and was taken for one.

## Refreshing on an EmbedPDF bump

1. Bump `@embedpdf/engines` / `@embedpdf/models` (and peers) together.
2. Re-apply or recreate the patch:
   - `pnpm patch @embedpdf/engines@<new>`
   - Port the `resolveEmbedPdfPageColors` helper and the `renderRectEncoded`
     color-scheme branch onto the new dist bundles (direct + worker, ESM + CJS).
   - `pnpm patch-commit <edit-dir>`
   - Same for models types if the upstream interface still lacks `pageColors`.
3. Run `pnpm install`, then PDF unit / browser checks. Two tests render figure.pdf (a label on a
   light box, coloured bars, thin marks and a picture) on dark paper and fail when one of them
   comes out wrong, for example if the engine no longer leaves pictures opaque in the
   color-scheme render: `test/unit/dark-page-engine.test.ts` with the real PDFium (part of
   `pnpm check`) and `test/browser/dark-paper.spec.ts` on the picture the viewer shows.
4. If upstream ships #679-equivalent wiring, delete both patches, remove
   `patchedDependencies` entries, and keep the Lumia flag true.

## Limits

- A dark page costs two renders and a pixel pass (about 7 ms per 1.3 MP page
  on the main thread), so about twice a normal page's render time.
- Embedded pictures and scanned pages stay as authored (often bright):
  the second render leaves them opaque, so they are not inverted. Shadings
  (gradients) are pictures to the color scheme too, and stay as authored.
- Vector content drawn over a picture keeps its authored colours there.

## Packaging footgun

`pnpm package` bundles whatever `@embedpdf/engines` is currently in
`node_modules`. After pulling the patch (#467), a tree that never re-ran
`pnpm install` still has the stock Matrix-only engines package (folder name
without `patch_hash=…`). The resulting VSIX looks fine (WASM still exports
ColorScheme Start; status can show Follow (Dark)) but paper stays white.

CI always runs `pnpm install --frozen-lockfile` before `pnpm package`, so CI
artifacts include the patch. Locally: **reinstall after the patch lands**, then
package. `scripts/build.mjs` and `.github/scripts/check-vsix.sh` assert
`resolveEmbedPdfPageColors` / `0xff1e1e1e` / `useColorScheme` in
`dist/pdf/webview/viewer.js` so an unpatched ship fails the build. The dark
page still needs the patch: its second render is the color-scheme render.
