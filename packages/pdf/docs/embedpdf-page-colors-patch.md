# Dark paper and EmbedPDF 3

**Dark paper is off.** EmbedPDF 3 has no page colour-scheme render, so every
page is drawn on white paper whatever `lumiere.pdf.pageColors` says, until a
render path that honours a colour scheme is back. The setting, its editor
theme follow and `shared/dark-page.ts` (the pure lightness inversion) are kept
for that day; `PAGE_COLORS_ENGINE_AVAILABLE` in
`src/shared/page-colors-engine.ts` is the one switch, and
`renderablePageColors()` returns "normal" while it is false.

## History

Lumia dark paper on EmbedPDF 2.15.1 needed a `pnpm patch` of
`@embedpdf/engines` (and a small `@embedpdf/models` types patch). The patch
let the PDFium colour-scheme render
(`FPDF_RenderPageBitmapWithColorScheme_Start`) be asked for, upstream
[embedpdf/embed-pdf-viewer#679](https://github.com/embedpdf/embed-pdf-viewer/issues/679).
Lumia rendered each dark page twice, as authored and with the colour scheme on
a transparent background (to find the pictures), and `darkenPage` inverted the
lightness of everything else while keeping its hue.

EmbedPDF 3 replaced those packages (`@embedpdf/engine`,
`@embedpdf/engine-runtime-wasm32`), so the patches, `patchedDependencies`, the
page bitmaps (`page-bitmaps.tsx`, `dark-render.ts`) and the VSIX marker check
for the patch are deleted. EmbedPDF's render options now end at size,
rotation, background and the layers drawn. The runtime still exports PDFium's
colour-scheme render, but nothing public reaches it.

## Bringing it back

1. Find a v3 render that takes a colour scheme: an upstream option, or the
   runtime's colour-scheme render reached from a Lumia render path.
2. It must keep what the old path guaranteed: ink and fills with different
   colours stay different, a label on a box stays readable, and pictures stay
   as authored (the colour-scheme render with alpha 1 on a transparent
   background marks them). `test/support/dark-figure.ts` checks a figure
   (`figure.pdf`: a label on a light box, coloured bars, thin marks and a
   picture) on page pictures.
3. Flip `PAGE_COLORS_ENGINE_AVAILABLE`, restore the dark-paper browser spec
   (`test/browser/dark-paper.spec.ts`) and the unit test with the real
   engine, and restore the wording of the setting in `contributes.json`.

## Limits of the old approach

- A dark page cost two renders and a pixel pass (about 7 ms per 1.3 MP page
  on the main thread), so about twice a normal page's render time.
- Embedded pictures, scanned pages and shadings stay as authored (often
  bright), and vector content drawn over a picture keeps its colours there.
