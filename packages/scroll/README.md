# @workshop/scroll

How Lumiere and Lumiere PDF read a wheel or trackpad scroll, defined once for
both:

- `src/axis-lock.ts`: `AxisLock` decides, once per gesture and from its first
  few events, whether a nearly straight scroll is locked to the vertical or the
  horizontal axis (what VS Code's `editor.scrollPredominantAxis` and AppKit's
  `usesPredominantAxisScrolling` do), or is diagonal and scrolls freely. It
  only classifies; each product applies the answer to its own scrollers
  (Markdown: `packages/markdown/src/plugins/scrollAxisLock`; PDF:
  `packages/pdf/src/webview/axis-lock-wheel.ts`).

Pure TypeScript: no DOM, VS Code or Node APIs (`WheelSample` is the part of a
`WheelEvent` it reads). The rule, with its constants (a rail is within 26.6
degrees of an axis, a gesture ends with a 150 ms pause, Ctrl and Cmd pinches
pass untouched), is in the module's comments and pinned by `test/`.
