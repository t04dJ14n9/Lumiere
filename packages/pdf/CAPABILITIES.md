# Capabilities (Lumia PDF)

What Lumia PDF does, plugin by plugin. Details live in each plugin folder and
in [README.md](README.md). Highlight **store** is vault Markdown (Chrome
`#page=` + `#:~:text=`), not sidecar files — see
[docs/sidecar-highlights.md](docs/sidecar-highlights.md) for legacy `#hl-`
open only.

## Core

| Plugin | What it does | Notes |
| --- | --- | --- |
| pdf | Custom editor, panels, Open Location, native links | Tracks editors per panel |
| agentBridge | **Copy link to this** → clipboard Quote / page link; MCP bridge (opt-in) | Clipboard only — does not open agent chat |
| ideContext | IDE Context delivery of a selection | Separate from Copy link |
| pdfAnnotations | Annotate mode; Highlight / Note / freeText / underline / ink burn into the PDF | Del deletes embedded annots |
| pdfBacklinks | Vault Markdown index → backlink overlays on open PDF | Derived cache only; refresh on MD save |
| pdfSidecar | Legacy `#hl-` open from existing `*.pdf.lumiere.md` | No create/upsert; no auto-delete |
| pdfRegions | Empty-page / Select Region + optional `viewrect=` in Copy link | **Off by default** (`lumiere.pdf.regions.enabled`) |
| pdfOutline | Explorer PDF Outline + Follow Cursor | Accordion like Markdown Outline |
| pdfHistory | In-memory Back / Forward for deliberate jumps | |
| pdfToolbar | Chrome / slim / floating controls | |
| pdfSettings | PDF: Open Settings / Change Setting… | |
| pdfZen | Enter / Exit Zen Mode | |
| pdfLookUp | macOS Look Up (force-click / three-finger) | |

## Product rules (locked)

- New Copy link: Quote with `#page=N#:~:text=…` when text is selected; page-only `#page=N` otherwise. Never `#hl-`, never PDF++ `selection=`, never RFC `search=`. `viewrect=` only when regions are enabled.
- Passage highlights = Markdown links in notes; overlays ignore Del/Backspace.
- Hard-written Annotate marks stay in the PDF; Del deletes those.
- No auto-migrate / auto-delete of `*.pdf.lumiere.md`.
