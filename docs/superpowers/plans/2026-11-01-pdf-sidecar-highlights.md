# PDF sidecar highlights — implementation plan

**Design:** [`../specs/2026-11-01-pdf-sidecar-highlights-design.md`](../specs/2026-11-01-pdf-sidecar-highlights-design.md)
**Package:** `packages/pdf` (plus one line in `packages/markdown/src/host/navigation.ts`)
**User doc:** `packages/pdf/docs/sidecar-highlights.md`

## Decisions the design left to this plan

| Topic | Choice | Why |
| --- | --- | --- |
| Overlay API (`importAnnotations` vs own layer) | **Own layer.** The highlight tool keeps EmbedPDF's text-selection UX through its `selectionHandler` hook, but creates no EmbedPDF annotation; the viewer draws sidecar highlights itself (`sidecar-layer.tsx`). | Nothing of a sidecar highlight ever enters the PDFium document, so `saveAsCopy` cannot embed it: the hard invariant holds by construction, with no strip-before-save step to get wrong. A browser test still checks the bytes of a later underline save. |
| Highlight-only vs all text markup | **Highlight only** in this slice. Underline, strikeout, squiggly, ink and shapes keep writing the PDF. | As the design allows. |
| Sticky discovered path vs always primary | **Sticky.** With `directory`, an existing sibling sidecar is read and written until the reader moves it. | Never two divergent sidecars. |
| `#hl-` resolution | Host side: the plugin looks the id up in its parsed sidecar and sends the viewer an ordinary `goTo` with the highlight's bounds (the existing flash). | Reuses navigation, history and the flash. |
| Hosts without the plugin | The viewer is told `sidecar: null` (the default) and the highlight tool writes the PDF as before. | The desktop app and DSH run no PDF plugins yet. |

## Slice 1 — sidecar highlights (done 2026-11-01)

- [x] Pure model: placement (`sibling` / `directory`, validation, misconfiguration fallback), file format (parse, create, upsert in place, remove, JSON-quoted strings that cannot close the comment), ids and `#hl-` fragments, ownership guard, minimal text span — `test/unit/sidecar.test.ts`.
- [x] Messages `sidecar` (host → viewer) and `sidecarWrite` (viewer → host), validated both ways; stale-load writes dropped — `test/unit/sidecar-messages.test.ts`.
- [x] Settings `lumiere.pdf.sidecar.location` / `.directory`.
- [x] Plugin `pdfSidecar`: locate, read (open editor or file), watch, write through a minimal workspace edit when open, serialize writes, guard another PDF's sidecar, warn once on bad settings, reload on settings change.
- [x] `#hl-` links: `pdfPanels.handleFragment`; Open Location, the custom editor's own fragment and text-editor document links use it; `#hl-` wins over `page=`. Markdown notes pass `hl-…` fragments to Open Location — `test/unit/pdf-open-location.test.ts`, `packages/markdown/test/unit/editor/navigation-host.test.ts`.
- [x] Viewer: highlight tool → sidecar; overlay layer (dark paper variant); Annotate-mode click selects (EmbedPDF marks deselect, and back); Delete/Backspace and the menu's Delete Annotation remove it; selection reports `highlightId`.
- [x] **Copy link to this**: command title renamed; a selected sidecar highlight copies `path#hl-<id>` plus its quote — `test/unit/agent-text.test.ts`, `test/unit/contributions.test.ts`.
- [x] Browser: create → `sidecarWrite`, no `annotationSave`, no EmbedPDF mark; select + Delete; malformed host entries dropped; a later underline save contains no `/Highlight` and no sidecar id — `test/browser/sidecar.spec.ts`.
- [ ] Host GUI pass in a real VS Code window (sidecar file appears, reopen restores, note link jumps and flashes) with screenshots.

## Slice 2 — re-attach (not started)

- [ ] Pure matcher: find `quote` near `contextBefore`/`contextAfter` in page text; unique match → new rects.
- [ ] On open, when stored rects no longer sit on the quote's text, re-attach and rewrite that block (`modified`); no unique match → keep rects, draw the mark as stale.

## Slice 3 — citations and references (not started)

- [ ] Cite-mark detector (`[12]`, `[3,4]`, `(Author, 2020)`, `(Author et al., 2020)`) with fixtures; paragraph bounds from text rects; `cite-auto` overlay with its own style, never written to the PDF or (in v1) the sidecar.
- [ ] Bibliography model: References/Bibliography heading heuristics plus last-pages fallback; numeric and author-year keys.
- [ ] References list view (tree view like PDF Outline); activating a row jumps and flashes; unresolved rows toast quietly.
- [ ] Jumps from an in-text cite to its entry.
- [ ] PDF hash unchanged after detection (browser).

## Slice 4 — other hosts (not started)

- [ ] Sidecars in host-node (desktop app, DSH): the same plugin logic over host-node's file services.
