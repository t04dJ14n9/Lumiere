# Capabilities (Lumiere PDF)

What Lumiere PDF does, plugin by plugin. Details live in each plugin folder and
in [README.md](README.md). Highlight **store** is vault Markdown (Chrome
`#page=` + `#:~:text=`).

## Core

| Plugin | What it does | Notes |
| --- | --- | --- |
| pdf | Custom editor, panels, Open Location, native links | Tracks editors per panel |
| agentBridge | **Copy link to this** → clipboard Quote / page link; MCP bridge (opt-in) | Clipboard only — does not open agent chat |
| ideContext | IDE Context delivery of a selection | Separate from Copy link |
| pdfAnnotations | Annotate mode; Highlight / Note / freeText / underline / ink kept in `<annotations.folder>/<sha256>.json` (default `.lumiere/pdf-annotations`); Save Annotations into This PDF, Export Annotated Copy… | The PDF is written only by Save into This PDF, never under `annotations.protectedFolders` |
| pdfBacklinks | Vault Markdown index → backlink overlays on open PDF | Derived cache only; refresh on MD save |
| pdfRegions | Empty-page / Select Region + optional `viewrect=` in Copy link | **Off by default** (`lumiere.pdf.regions.enabled`) |
| pdfOutline | Explorer PDF Outline + Follow Cursor | Accordion like Markdown Outline |
| pdfHistory | In-memory Back / Forward for deliberate jumps | |
| pdfToolbar | Chrome / slim / floating controls | |
| pdfSettings | PDF: Open Settings / Change Setting… | |
| pdfZen | Enter / Exit Zen Mode | |
| pdfLookUp | macOS Look Up (force-click / three-finger) | |

## Product rules (locked)

- New Copy link: Quote with `#page=N#:~:text=…` when text is selected; page-only `#page=N` otherwise. Never PDF++ `selection=`, never RFC `search=`. `viewrect=` only when regions are enabled.
- Passage highlights = Markdown links in notes; overlays ignore Del/Backspace.
- Annotate marks are kept outside the PDF, by its SHA-256; the PDF's bytes never change unless the reader runs Save Annotations into This PDF (refused in protected folders). Del deletes Lumiere's marks.
- The engine is EmbedPDF 3 (one Stage lays out, scrolls and zooms the pages). The annotation file is `{ "version": 2, "bundle": … }`; version 1 files are converted when read. Dark paper (`pageColors` dark) is off until EmbedPDF 3 can draw a colour scheme: pages stay white (`docs/embedpdf-page-colors-patch.md`).
