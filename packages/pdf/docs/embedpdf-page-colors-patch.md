# Dark paper and EmbedPDF 3

Dark paper (`lumiere.pdf.pageColors` dark, or Follow on a dark theme) is drawn
by the PDF engine, as it was on EmbedPDF 2.15.1. The file keeps its old name,
but nothing is patched any more: EmbedPDF 3 has no page colour-scheme option,
so Lumiere runs the engine's host with its own page reader
(`src/engine-worker`) and leaves `node_modules` alone.

## How a dark page is drawn

Lumiere renders each dark page twice, at the same size, and
`darkenPage` (`src/shared/dark-page.ts`, pure) turns the two into one picture:

- **As authored**: EmbedPDF's own `PageRenderReader`, on white paper.
- **With PDFium's colour scheme**, on a transparent background and with ink
  that is all but transparent (`FORCED_PAGE_COLORS`). The scheme recolours
  vectors and text but leaves embedded pictures and shadings alone, so what is
  opaque in this render is a picture. Only its alpha is used.

`darkenPage` inverts the lightness of every pixel that is not a picture,
keeping its hue (black ink becomes light, a light box dark, red stays red),
and leaves picture pixels as authored. PDFium's colour scheme alone would
paint every filled shape and all text one colour each, and a label on a box
would vanish; the two renders are why it does not.

## Where it runs

```
viewer (page)                         engine worker (blob worker)
-------------                         ---------------------------
rememberPageColors(mode)  --post-->   worker-boot.ts   { kind: "lumiere.pageColors", mode }
render.invalidate()                   dark-host.ts     host.handlePagesRender
 RenderLayer asks for pictures  -->     mode normal: EmbedPDF's handler, unchanged
                                        mode dark:   that, then the colour-scheme render,
                                                     darkenPage, and one raster back
```

- `src/engine-worker/worker-entry.ts` is the worker's script. EmbedPDF's own
  (`@embedpdf/engine/worker-entry`) boots a `WorkerHost` and hands it every
  request; `worker-boot.ts` does the same handshake (`init`, `ready`,
  `init-error`) with the host from `dark-host.ts`.
- `dark-host.ts` creates EmbedPDF's `WorkerHost` and replaces its
  `handlePagesRender` (every page and tile the render plugin asks for goes
  through it). The mode is the host's state, set by the viewer's
  `{ kind: "lumiere.pageColors", mode }` message: EmbedPDF's render plugin
  forwards no option it does not know, so it cannot be a field of the request.
  In normal mode the answer is EmbedPDF's, untouched.
- `color-scheme-runtime.ts` is the colour-scheme render. It gives a second
  `PageRenderReader` a runtime whose `EPDF_RenderPageBitmapWithMatrix_Start`,
  `EPDF_RenderPage_Continue` and `FPDF_RenderPage_Close` answer with
  `FPDF_RenderPageBitmapWithColorScheme_Start`, `FPDF_RenderPage_Continue` and
  the same `Close`. The reader still allocates the bitmap, works out the area
  of a page or a tile, slices the render and reads the pixels, so a tile of a
  dark page is the part of the dark page it shows. The scheme call wants the
  rectangle the whole page lands on and the quarter turn, where the reader
  has a matrix: `placementOf` turns one into the other. The pause callback
  stops PDFium once the slice's budget is spent, so an abort is heard as soon
  as for a normal page.
- In the page, `page-colors.ts` tells the engine the new mode first and then
  its listeners; `page-colors-render.ts` (`useRepaintOnPageColors`) calls
  `render.invalidate()`, so every picture is asked for again and drawn in the
  new mode. `host.ts` applies the host's `pageColors` message when it
  arrives, before the viewer mounts, so the first pictures of a dark editor
  are already dark.

## Build

`scripts/engine-worker.mjs` is an esbuild plugin: `import "lumiere:engine-worker"`
is `worker-entry.ts` built as an IIFE (the recipe of EmbedPDF's
`scripts/build-workers.mjs`: ES2020, `import.meta.url` as `self.location.href`)
and exported as a string, which `browser-render-environment.ts` starts as a
blob worker. `scripts/viewer.mjs` (so the extension, the web app and the iPad
app) uses it, and stubs EmbedPDF's own worker and in-thread transport
(`scripts/embedpdf-stubs.mjs`), which Lumiere no longer starts.

The main-thread fallback (a worker that cannot start) runs the same host:
`inline-transport.ts` is the transport of an engine in the page's own thread,
and draws dark paper the way the worker does.

## What is pinned

`dark-host.ts` reads three private members of EmbedPDF's `WorkerHost`
(`handlePagesRender`, `requireSession`, `slices`). They exist in the pinned
`@embedpdf/engine-services@3.0.0`, and the host refuses to start without them
rather than leave dark pages quietly white. The struct layouts in
`color-scheme-runtime.ts` (`FPDF_COLORSCHEME`, and `IFSDK_PAUSE` on wasm32) are
PDFium's.

When bumping EmbedPDF:

1. `test/unit/dark-page-engine.test.ts` renders `figure.pdf` through the real
   runtime and host: readable text and labels, bars that keep their hue, the
   picture as authored down to its edges, tiles equal to the page they cut,
   every render turn and `/Rotate` pages. It fails if the colour-scheme render
   stops leaving pictures opaque, or if the host's shape changes.
2. `test/unit/engine-worker-boot.test.ts` covers the worker handshake the
   engine waits for; `test/browser/dark-paper.spec.ts` the page the viewer
   shows.
3. Compare `src/engine-worker/worker-boot.ts` with `bootstrap.ts` of the new
   `@embedpdf/engine`.

## Limits

- A dark page costs a second render and a pixel pass over the page: a plain
  text page of 2.2 MP took 13 ms against 2 ms (PDFium's WASM in Node, the
  pass being about 4 ms per megapixel). It runs in the engine worker, so it
  does not block scrolling, but a dark page arrives later than a white one.
- Embedded pictures, scanned pages and shadings stay as authored (often
  bright), and vector content drawn over a picture keeps its colours there.
- A tile or page is placed by whole pixels: the colour-scheme render is up to
  half a pixel from the render as authored at a fractional scale, which only
  matters at a picture's edge.
- The setting, the editor theme follow and `PAGE_COLORS_ENGINE_AVAILABLE`
  (`src/shared/page-colors-engine.ts`, the one switch that turns dark paper
  off, with `renderablePageColors()`) are unchanged.

## History

On EmbedPDF 2.15.1 dark paper needed a `pnpm patch` of `@embedpdf/engines`
(and a types patch of `@embedpdf/models`) so that PDFium's colour-scheme render
(`FPDF_RenderPageBitmapWithColorScheme_Start`) could be asked for, upstream
[embedpdf/embed-pdf-viewer#679](https://github.com/embedpdf/embed-pdf-viewer/issues/679).
EmbedPDF 3 replaced those packages, so the patches went with them, and dark
paper was off until this host brought it back with no patch.
