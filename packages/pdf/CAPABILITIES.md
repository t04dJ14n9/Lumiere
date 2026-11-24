# Capabilities (Lumiere PDF)

What Lumiere PDF does, plugin by plugin. Details live in each plugin folder and
in [README.md](README.md). Highlight **store** is vault Markdown (Chrome
`#page=` + `#:~:text=`).

## Core

| Plugin | What it does | Notes |
| --- | --- | --- |
| pdf | Custom editor, panels, Open Location, native links | Tracks editors per panel |
| agentBridge | **Copy link to this** → clipboard `@` locator and quote; MCP bridge (opt-in) | Clipboard only — does not open agent chat |
| ideContext | IDE Context delivery of a selection | Separate from Copy link |
| pdfAnnotations | Context menu on selected text: Highlight, Underline, Strikeout, Squiggly (side by side), Highlight with Note; on a mark: Edit Note…, Change Color ▸, Delete Annotation. A mark's note shows in a hover card as Markdown and is written in it (`webview/note-card.tsx`). Kept in `<annotations.folder>/<sha256>.json` (default `.lumiere/pdf-annotations`); Save Annotations into This PDF, Export Annotated Copy… | The PDF is written only by Save into This PDF, never under `annotations.protectedFolders` |
| pdfBacklinks | Vault Markdown index → backlink overlays on open PDF | Derived cache only, built from the first PDF opened; refresh on MD save, one push per burst |
| pdfRegions | Empty-page / Select Region + optional `viewrect=` in the Copy link locator | **Off by default** (`lumiere.pdf.regions.enabled`) |
| pdfOutline | Explorer PDF Outline + Follow Cursor | Accordion like Markdown Outline |
| pdfBookmarks | The reader's own bookmarks: **Add Bookmark** (⌘D / Ctrl+D), **Go to Bookmark…** (Quick Pick, rename and delete buttons), Explorer **PDF Bookmarks** view | Kept in `<annotations folder>/<sha256>.bookmarks.json` (`{ "version": 1, "bookmarks": [{ id, title, page, position, created }] }`), merged by id, watched across windows; a sidecar, so the PDF is never written and protected folders are fine. Also sent to each editor's side panel Bookmarks tab (`panel-feed.ts`) |
| (pdf) | **PDF: Toggle Side Panel**, in the right-click menu too, and its editor title button: a panel inside the viewer (Thumbnails, Outline, Bookmarks, Annotations) that goes with the PDF into a floating window | Hidden at first; state per editor, the last choice starts the next (`lumiere.pdf.sidePanel`); no default key. The native PDF Outline is unchanged |
| pdfHistory | In-memory Back / Forward for deliberate jumps | |
| pdfToolbar | Chrome / slim controls | |
| pdfSettings | PDF: Open Settings / Change Setting… | |
| pdfZen | Enter / Exit Zen Mode | |
| pdfLookUp | macOS Look Up (force-click / three-finger) | |

## Product rules (locked)

- Copy link: `@path#page=N`, then the quoted text when text is selected, then a newline; the locator alone otherwise. Never PDF++ `selection=`, never RFC `search=`. `viewrect=` only when regions are enabled.
- Passage highlights = Markdown links in notes; overlays ignore Del/Backspace.
- No Annotate mode or button: marks are made and changed from the webview context menu only (`webview/mark-menu.ts`), and only Lumiere's own marks answer it; the reading tool never selects, moves or deletes one.
- A mark's note is Markdown, rendered with raw HTML and images off and only web and mail links (`shared/mark-note.ts`); it opens through the `openExternal` message, which the host checks again. Notes are written in the viewer's card, not in a VS Code prompt, so every host gets the same editor.
- Marks are kept outside the PDF, by its SHA-256; the PDF's bytes never change unless the reader runs Save Annotations into This PDF (refused in protected folders).
- The engine is EmbedPDF 3 (one Stage lays out, scrolls and zooms the pages). The annotation file is `{ "version": 2, "bundle": … }`; version 1 files are converted when read. Dark paper (`pageColors` dark) is drawn by the engine: EmbedPDF's host runs with Lumiere's page reader, which renders each dark page twice and inverts its lightness, keeping pictures as authored (`docs/embedpdf-page-colors-patch.md`).
