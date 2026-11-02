# PDF load time (real VS Code 1.141, Linux Xvfb, shared noisy box)

`PERF=1 pnpm exec playwright test -c test/vscode/playwright.config.ts test/vscode/perf.spec.ts`
writes the numbers (`before.json` is the baseline on `main`, `after.json` this branch).
Times are ms after choosing the file; run-to-run noise on this box is about ±150 ms
(three runs of the same build gave first-page 1303-1720 ms for the small PDF).

| step | before (small) | after (small) | before (600 pages) | after (600 pages) |
|---|---|---|---|---|
| viewer script starts | 697 | 754 | 517 | 501 |
| PDF bytes arrive | 869 | 944 | 694 | 687 |
| engine ready | 1198 | 1271 | 822 | 811 |
| document opened | 1418 | 1488 | 1108 | 1080 |
| first page painted | 1672 | 1720 | 1373 | 1428 |

Activation: 4 ms. Bundles: viewer.js 3.1 MB (React, EmbedPDF and both PDFium
engines in one file; 86 ms to load), pdfium.wasm 4.6 MB.

What changed: the PDFium WASM is now fetched when the viewer starts, while the
host is still sending the PDF, instead of after the bytes arrive (`warmWasm`).
The saving is the fetch (110-300 ms in the baseline resource timings) taken off
the critical path, but it is below this box's noise, so **no gain is claimed**;
the remaining cost between "bytes arrive" and "engine ready" (about 125 ms warm,
about 330 ms cold) is worker start-up and WASM compilation. Splitting the
bundle (the main-thread engine is only a fallback) needs ESM output in the
webview and was not attempted.

No CI perf budget: the timings vary more than any budget that would catch a
regression without flaking.

## The first fit, 2026-11-01

Real VS Code 1.144 on Linux Xvfb, `PERF=1` probe above, production build
(`node scripts/build.mjs --production` at the repository root, which is
what the VSIX packs); ms from document opened to first page painted:

| | baseline (3 runs) | first fit now (5 runs) |
|---|---|---|
| small (12 pages), first in the window | 220, 215, 218 | 111, 68, 224, 86, 265 |
| 600 pages | 216, 227, 955 (outlier) | 127, 92, 99, 120, 118 |

The small PDF is the first one the window opens, and varies most. In the
browser harness (production build, seven runs each) the same segment went
from a median of 197 to 57 ms.

Cause: EmbedPDF's zoom plugin re-fits an automatic zoom 150 ms after a
viewport resize (a debounce for window drags). The viewport first gets its
size when the viewer mounts, after the document loaded, so the first fit,
and every page (the viewport is gated until the zoom is known), waited out
that debounce. `webview/first-fit.ts` requests the same automatic zoom on the
first size, at once. It takes the zoom capability, not `useZoom`: that hook's
`provides` is a new object on every render, so an effect depending on it
fits again after every render, and undid every jump (the first version did,
and the browser suite caught it).

Tried and dropped, each measured with three runs before and after in real
VS Code (no gain beyond the box's noise):

- Starting the PDFium worker engine before the bytes arrive (an engine head
  start for the first document): worker start-up is not on the critical
  path; "engine ready" and "document opened" did not move.
- Reading the PDF on the host when the panel opens instead of on `ready`:
  the 240 to 320 ms between the viewer starting and the bytes arriving is
  messaging, not the file read.
- JPEG or WebP page bitmaps instead of PNG: no faster at the harness's sizes
  (WebP slower), and JPEG blurs text.

Note: `pnpm build` is a development build (React's development mode); its
timings overstate the production ones and can hide gaps such as this one.
