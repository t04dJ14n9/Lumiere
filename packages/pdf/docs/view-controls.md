# PDF view controls

Single-page and two-page layouts are the `spread` setting of EmbedPDF 3's
Stage (`@embedpdf/plugin-stage` 3.0.0), which also owns the flow (continuous
or paged), the layout (vertical or horizontal), the zoom and the scrolling.
`SpreadMode` `none` displays individual pages; `odd` pairs 1–2, 3–4; `even`
leaves the cover alone and pairs 2–3, 4–5. Both spread layouts support
vertical and horizontal reading, continuous and page-by-page scrolling, page
jumps, fit modes and saved views.

## Implementation decisions

Made against the installed EmbedPDF **3.0.0** declarations and implementation
(`webview/plugins.ts`, `stage-layout.ts`, `stage-position.ts`, `navigation.ts`,
`reading-position.ts`). Lumiere's choices keep their own names; `stage-layout.ts`
maps them to the Stage's settings, once for registration and once for every
live change.

| Area           | EmbedPDF 3 support                                                                                                                              | Decision                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar        | Not EmbedPDF's concern.                                                                                                                         | `ToolbarControls` is the slim bar of the web and iPad hosts; chrome (the VS Code default) uses commands, editor title actions and page/zoom status entries. There is also a hidden `none` mode. |
| Zoom           | `ZoomSpec`: `fit-width`, `fit-page`, or a level. `stage.zoomTo` takes any of them; fit modes measure whole spreads and stay live while resized. | `viewUnitsPerPoint: 1`, so 100% is one pixel per point. Actual size is level **1**; custom percentages keep the 25–400% range. Buttons and keys walk Lumiere's ladder (`shared/zoom-steps.ts`). |
| Spreads        | `spread: 'none' \| 'odd' \| 'even'` in the Stage settings.                                                                                       | Map `single` to `none`, `spread` to `odd`, and `spreadCover` to `even`; one `updateSettings` for a combined change.                                                                           |
| Direction      | `layout: 'vertical' \| 'horizontal'`. Next/previous move by the shown item, a page or a spread.                                                  | Reuse it for both directions and spread stepping.                                                                                                                                             |
| Page-by-page   | `flow: 'paged'` shows one item at a time and turns at its edge with wheel or trackpad.                                                          | Use it; Lumiere adds the arrow and Page keys (`shared/paging-keys.ts`) on top of Stage verbs, with `lumiere.pdf.view.arrowsKeepPlace` for ←/→.                                                  |
| Page jumps     | `goToPage`, `reveal` and `scrollTo` take `behavior: 'smooth'`.                                                                                  | Smooth jumps when enabled in continuous flow; restoration and page-by-page changes are instant.                                                                                               |
| Wheel          | Ctrl/⌘+wheel and pinch zoom around the pointer; a notch zooms by 1.2.                                                                           | Adopt it. Plain wheel notches in continuous flow are animated by Lumiere (`webview/smooth-scrolling.ts`); other pixel deltas pass through.                                                      |
| Zoom animation | The camera moves on each pinch or wheel event; pages are rescaled, then re-rendered sharp when it rests.                                        | No Lumiere animation. Zoom from the buttons, keys and menu is a single step.                                                                                                                    |
| Persistence    | The registered settings and zoom decide the first layout.                                                                                       | Reading position and zoom survive a file rebuild in a module outside React; the last validated report is saved on panel disposal for reopen. Open panels keep independent state.              |

## Controls

The Stage centres content and keeps the zoom focus. There is no scroll
element: Lumiere reads and moves the view with Stage verbs, and the pages
shorter than the viewer cannot reach its top (the Stage clamps the end of the
document, as a scrolling page would).

**View** exposes zoom mode, page layout, scrolling mode and direction in the
slim bar of the web and iPad hosts, and through a status bar picker and editor
action in VS Code's chrome mode. All choices are also available as PDF
commands and in the PDF context menu, including when the toolbar is hidden.

- **Fit width** fits the document's widest page or spread; **Fit page**
  fits the document's largest page/spread dimensions. **Actual size** selects 100%. Type a custom
  percentage in the existing zoom field or zoom picker.
- **Single page** (`single`, native `none`) displays individual pages.
  **Two pages** (`spread`, native `odd`) pairs 1–2, 3–4.
  **Two pages with cover** (`spreadCover`, native `even`) displays page 1
  alone, then 2–3, 4–5. An unpaired final page appears alone.
  Next/previous moves to the adjacent spread; go to page opens the containing
  spread. Box, outline and internal-link destinations retain their page coordinates.
  Changing pairing or direction keeps the current page in view.
- **Continuous** scrolls through the document. **Page-by-page** displays one
  page or spread at a time; use next/previous or go to page to change it.
  At larger zooms, pan within that page/spread with wheel, trackpad or keys.
- **Vertical** and **Horizontal** choose the continuous reading direction.
- Smooth motion applies to discrete wheel scrolling and page/outline/internal
  link jumps. Native trackpad scrolling is retained, and zoom changes are not
  animated. Motion is always disabled with `prefers-reduced-motion: reduce`.

## Settings

Defaults apply to PDFs without a saved view. Reopening restores the saved
page, offsets, zoom, layout, scrolling mode and direction. File rebuilds keep
the current panel's view. Changing the page-layout setting updates open PDF
panels; commands and toolbar choices target their own panel. Other default
settings apply on a new view, while smooth-scrolling changes apply immediately.
An unrelated settings update preserves a panel's chosen or saved layout.

| Setting                               | Values / default                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `lumiere.pdf.view.defaultZoom`     | `fitWidth` (default), `fitPage`, `actual`, or a numeric percentage (25–400)                                |
| `lumiere.pdf.view.pageLayout`      | `single` (default, native `none`), `spread` (native `odd`), `spreadCover` (native `even`)                     |
| `lumiere.pdf.view.scrollMode`      | `continuous` (default), `paged`                                                                            |
| `lumiere.pdf.view.scrollDirection` | `vertical` (default), `horizontal`                                                                         |
| `lumiere.pdf.view.restoreOnReopen` | `true` (default): reopen a PDF at its last page, scroll position, zoom and view choices; `false`: always start from the defaults |
| `lumiere.pdf.view.smoothScrolling` | `null` (default: follows `editor.smoothScrolling`), `true`, `false`; reduced motion overrides all settings |

## Commands

Command ids use the `lumiere.pdf.` prefix. Existing `fitWidth`, `fitPage`,
`zoomIn`, `zoomOut`, `selectZoom`, `goToPage`, `nextPage`, and `previousPage`
remain the controls for zoom and navigation. New view choices use
`actualSize`, `selectView`, `singlePage`, `twoPageSpread`, `twoPageCover`,
`continuousScroll`, `pageByPage`, `verticalScroll`, and
`horizontalScroll`. Each command targets the active PDF panel.

## Verification

Unit coverage exercises native spread mapping, settings, view/action validation, saved positions,
wheel animation arithmetic and reduced-motion resolution, and drives the navigation hooks against EmbedPDF's real Stage. Additional unit
coverage verifies independent same-file panels and exact saved zoom/offsets.
Browser specs cover controls, native spread pairing in both directions, spread
navigation and fit modes, panning bounds, motion and restoration; one VS Code
spec covers spread commands and reopening.

Run lint, typechecking, the build and unit tests locally. Browser and real-editor
specs require Chromium/VS Code and permission to open local listening sockets;
they cannot run in sandboxes that deny those sockets. The real-editor specs
(`pnpm test:vscode`) do not run in CI; run them locally before every push
(`xvfb-run -a pnpm check:full` on headless Linux).

## Screenshots (real VS Code)

Chrome mode: the status bar's **View** entry opens the picker.

![PDF View picker](images/view-controls-chrome-picker.png)

Two pages with cover (page 1 alone, then 2–3), fit page:

![Two pages with cover](images/view-controls-two-pages.png)

Slim bar (web and iPad hosts): the **View** menu next to the zoom controls.

![Slim bar View menu](images/view-controls-slim-menu.png)
