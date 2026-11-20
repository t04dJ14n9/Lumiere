# Changelog

## Unreleased

- Leaving a PDF no longer moves the keyboard focus to restore VS Code's
  Outline (it focused the main window's Outline, then the active editor
  group, a moment after the reader had left, possibly for another window).

- Fixed (review 2026-11-15):
  - The host writes a PDF only for Save Annotations into This PDF, and never
    one in `lumiere.pdf.annotations.protectedFolders`, whatever the viewer
    sends.
  - After a PDF failed to reload from disk, later annotations were silently
    not saved until the editor was reopened.
  - Annotations made while a PDF was reloading were lost or filed under the
    wrong version of the PDF; the viewer now names the hash it saved for.
    Touching or syncing an unchanged PDF no longer reloads it.
    An annotation made while Save Annotations into This PDF is writing is
    kept, and filed under the PDF as written, instead of being lost on the
    next open.
    Each save into the PDF settles only the annotations it wrote, so one
    that fails no longer loses annotations an earlier one did not take; a
    change made during the write to one it took is reported as a change to
    the PDF's annotations rather than dropped.
  - The selection handed to Codex is written in a private temporary folder,
    and the agent bridge compares its token in constant time.

- **Empty-page drag pans and turns pages.** With region selection off (the
  default), dragging blank page space pans the view in continuous scrolling.
  In page-by-page scrolling, a blank-page drag that travels 60 CSS pixels
  of the viewer (Stage viewport / EmbedPDF screen px, not PDF points; the
  same at every zoom) turns the page. It does not only pan inside a Fit
  Width page. Mouse and pen reach that handler only on loaded blank space:
  a drag over text or a page whose text geometry is not ready stays with
  text selection or Stage pan. Touch keeps EmbedPDF's native navigation and
  pinch; the handler does not claim touch contacts. Device touch has not
  been GUI-verified. Text selection, citation link clicks, wheel and
  keyboard navigation, and zoom are unchanged. Turning on
  `lumiere.pdf.regions.enabled` still uses empty-page drag to draw a region.

- **Lumia PDF moves to EmbedPDF 3.** The viewer's engine and page surface are
  rebuilt on EmbedPDF 3.0.0.
  - *Better:* text selection, search hits, Look Up, links and backlink overlays
    follow the text with exact (fractional) page geometry. The pages, their
    zoom and their scrolling are one surface (the Stage), so a zoom step
    can no longer scroll a frame before the pages are laid out at the new
    size, and a saved place comes back before the first page is drawn. Pages
    stored with a `/Rotate` entry also embed turned the way the PDF says in
    Markdown (`![[paper.pdf#page=3]]`), not sideways.
  - *Changed:* Ctrl/⌘+wheel and pinch zoom are EmbedPDF's: a wheel notch zooms
    by 1.2 around the pointer (it used to step through 25, 33, 50 … 400%) and
    a pinch rescales the pages, which sharpen when it rests. The zoom
    buttons, keys and menu still step through those levels, but jump to the
    next one without the animation. Annotation files
    (`.lumiere/pdf-annotations/<sha256>.json`) are in a new format, version 2;
    files from earlier versions are converted when read and saved in the new
    format at the next change, after which earlier versions cannot read them.
    The extension is bigger: the PDF engine file is 7.9 MB instead of 4.6 MB
    and ships twice (the viewer and the Markdown editor's PDF embeds), and
    the viewer script is 4.2 MB instead of about 3 MB.
  - *Kept:* **dark paper** (`lumiere.pdf.pageColors`, **PDF: Cycle Page
    Colors**) draws as before. EmbedPDF 3 has no colour-scheme option, so the
    viewer runs EmbedPDF's engine host with Lumiere's own page reader, in the
    engine worker and in the main-thread fallback, instead of a patch of
    EmbedPDF's packages. See `docs/embedpdf-page-colors-patch.md`.

- **Annotations no longer change the PDF.** Highlights, notes, underlines,
  free text and ink are kept in `.lumiere/pdf-annotations/<sha256>.json` in
  the workspace folder, named by the PDF's SHA-256, and come back when the
  PDF opens. `lumiere.pdf.annotations.folder` sets another folder. A vault that records the hash of its immutable sources (such as
  `.raw/`) keeps a matching hash, and a PDF annotated in `inbox/` shows the
  same annotations once captured. **PDF: Save Annotations into This PDF**
  writes them into the file on request (refused in
  `lumiere.pdf.annotations.protectedFolders`, default `.raw`), and **PDF:
  Export Annotated Copy…** writes a new PDF. Annotations already in a PDF
  still show; changes to them are kept only by saving into the PDF.

- **Legacy PDF sidecars are gone.** Existing `*.pdf.lumiere.md` highlight files
  are no longer read, and `lumiere.pdf.sidecar.location` and
  `lumiere.pdf.sidecar.directory` are removed (delete them from your settings;
  your files are left on disk). A `#hl-` link now just opens the PDF, like any
  other fragment that names no page.

- **←/→ turn the page and keep your place.** Plain ←/→ now turn the page
  keeping the zoom and the place in it, as ⌥←/→ did. ⌥←/→ (Ctrl+Alt+←/→ on
  Windows and Linux) take the old meaning: pan a zoomed page, then turn to
  the top of the next. `lumiere.pdf.view.arrowsKeepPlace` (on by default)
  swaps them back when off.

- **Section links from notes.** Lumia reads a PDF's bookmarks with Lumia
  PDF's PDFium (`dist/pdf/outline-engine.js`, loaded on first use) to suggest
  them after `[[paper.pdf#`.
- **Chrome-aligned PDF backlink overlays.** Passage highlights live in vault
  Markdown as Copy link Quotes (`#page=` + `#:~:text=`), not in
  `*.pdf.lumiere.md`. The viewer paints backlink overlays from those links
  (hover preview, click opens the note; Del ignores overlays). Annotate
  **Highlight** burns into the PDF again with Note / freeText. Sidecar create
  is torn down; legacy `#hl-` open remains best-effort. **Select Region** /
  empty-page drag and `viewrect=` in Copy link are opt-in via
  `lumiere.pdf.regions.enabled` (default off). See `CAPABILITIES.md`,
  `docs/sidecar-highlights.md`, and
  `docs/superpowers/specs/2026-11-04-pdf-backlink-overlays-chrome-design.md`.
- **Copy link to this** is clipboard-only (Quote or page link). It no longer
  opens agent chat. With no selection it copies a page-only `#page=N` link for
  the reading page.

- Zooming no longer flickers on a busy machine. A zoom step used to scroll
  to its new position a frame before the pages were laid out at the new
  size, so one frame could show another page, or nothing, in a long
  document. The new layout now lands in the same frame as the scroll.
- PDF Outline no longer flashes shut and open when the reading position
  moves into a bookmark that has children: it collapses the tree only when
  an open branch must close.
- PDF Outline follows the reading position by default
  (`lumiere.pdf.outline.followCursor` now defaults to on), and as an
  accordion like Markdown Outline: the current bookmark's parents and its
  sub-bookmarks open and every other branch closes. A click on a bookmark
  leaves the tree as it is, so a double-click's second click hits the same
  row.
- Lumière PDF is now called Lumia PDF wherever it shows: the viewer's name
  in **Reopen Editor With…**, command titles, settings titles, the MCP
  server's name and the author of new annotations. Ids (`lumiere.pdf.*`)
  are unchanged.
- PDFs show their first page sooner: about 100 ms less from the document
  opening to the first page in VS Code (the automatic zoom is now
  applied as soon as the viewer has a size, not after a 150 ms debounce).
- macOS Look Up: a hard press (or a three-finger tap) on a word shows the
  system's Dictionary popover, as in Preview. The viewer puts the word under
  the pointer into the page as invisible text for the system to find.
- The text selection no longer shows darker stripes where selected lines
  overlap (tightly set lines, or a line with a larger word).
- The extension was renamed from Agent PDF Viewer (EmbedPDF) to PDF Workshop (package `vscode-pdf-workshop`).
- `vscodeEmbedPdf.bridge.envelope` returns a Workbench v1 selection envelope
  (`producer: "pdf"`) matching Markdown Workshop's `BridgeEnvelope`
  (`capturedAt`, `source.identity` / `kind` / `media`, `locator`, `view`,
  `selection`, `revision`). Workshop may call this command; this command does
  not call Workshop back. The bridge envelope is separate from **Copy link to
  this** (clipboard Quote / page link — see Unreleased above).
  See `docs/bridge-envelope.md`.
- Memory-only, per-pane PDF location history: Back to Previous Location / Forward
  to Next Location restore page coordinates, zoom and view mode after deliberate
  jumps. Separate from page stepping and native file navigation; no keybindings changed.
- New navigation and reader input cancel delayed restoration. Queued host
  messages are tied to the current viewer load, and zero-offset destinations are preserved.
- Open Location validates PDF files, asks about ambiguous workspace paths, and
  rejects invalid page destinations. Cancelled or superseded queued requests are
  skipped. An already dispatched native editor open may finish, then the newest
  valid request opens last; stale requests never apply a page destination.
- PDFs render in Restricted Mode. Workspace values for `pdfWorkshop.agentBridge.enabled`
  and `pdfWorkshop.copyLinkForAgent.target` are ignored until the folder is trusted.
- Open Location safely handles malformed percent escapes and drops invalid or non-finite
  page rectangles supplied by links or other extensions.
- Turning pages no longer shows blank pages. Like macOS Preview, the viewer draws a page at once as a
  low-resolution picture and sharpens it in tiles as they are decoded (EmbedPDF 3's render layer; Lumia's own
  bitmap cache of the neighbouring pages is gone).
- Settings from the Command Palette: `PDF: Open Settings`, `PDF: Change Setting…` (every contributed setting, edited by
  type, generated from package.json), toggles for smooth scrolling and keyboard shortcuts, default zoom / layout /
  scrolling pickers, and `Settings…` in the View picker. Same keys as the Settings editor, workspace if set there
  else user. Docs: docs/settings.md.

- Zen mode: `PDF: Enter Zen Mode` / `Exit Zen Mode` (`Ctrl+Alt+Z`, `Ctrl+Cmd+Z` on macOS; `Escape Escape` exits)
  runs VS Code's Zen Mode; the chrome and slim toolbars become a floating bar with an Exit zen button while it
  lasts (never written to settings). Specs `zen.spec.ts` (browser and VS Code), docs/zen.md.

- Zoom from the buttons, keys and menu keeps the centre of the viewer in place
  like Preview, also when the page grows wider than the viewer (the scroll the
  zoom asked for was lost to a page not yet laid out, and in page-by-page mode
  clamped away); spec `zoom-anchor.spec.ts`.

- ⌥←/↑/→/↓ (macOS) and Ctrl+Alt+←/↑/→/↓ (Windows, Linux) turn the page keeping the
  zoom and the place in the page, as Preview does; commands
  `PDF: Previous/Next Page, Keeping Place`. Scoped and opt-out like the other
  shortcuts (`pdfWorkshop.keyboardShortcuts`).

- Fix: pages stored with a `/Rotate` entry (slides saved sideways, scans) were
  drawn sideways and in a box of the wrong shape: EmbedPDF opens documents with
  rotation normalised and leaves the turn to the viewer, which never made it.
  Such pages are now turned to the way the PDF says, with search hits, links
  and the text selection on the page; spec `page-rotation.spec.ts`.

- New plugin `pdfLookUp` (macOS only, `pdfWorkshop.lookUp.enabled`): Look Up in
  the right-click menu, and a force click, open the word under the pointer in
  the Dictionary app. Native three-finger-tap Look Up is not possible on
  image-drawn pages; see docs/look-up.md.
- Review fixes (round 1), internal: the extension is a set of plugins
  (`pdf`, `pdfToolbar`, `pdfOutline`, `pdfRegions`, `pdfLookUp`, `agentBridge`) started by
  a runtime that rolls back a plugin that fails to start and stops plugins
  in reverse order; tests check every plugin leaves nothing registered when
  it stops.
- The agent bridge starts only when it is enabled **and** used (a PDF is
  open or Copy MCP Setup was run), and its MCP server is a separate bundle
  loaded only then; `dist/extension.js` shrank from 1.6 MB to under 70 KB.
  The extension now activates when a PDF opens. The stdio shim is now
  included in the VSIX (it was missing).
- Region snapshots have a hard size limit: a snapshot larger than
  `pdfWorkshop.regionImageCache.maxSizeMB` is not saved (the handoff goes
  without the image and says why) instead of exceeding the cap.
- The viewer batches its state reports (outline, selection, page and zoom)
  into versioned patches, about one per frame; each reload disposes the
  previous PDF's engine and workers.
- `get_current_note_selection` returns the same text as Markdown
  Workbench's Copy Link for Agent (`@path#lines` and the quoted lines); the
  shared format is in `docs/agent-handoff-format.md`.

- The viewer's controls move into VS Code's own UI by default: editor title
  buttons and the page and zoom in the status bar (Go to Page, a zoom
  picker). `pdfWorkshop.toolbar.mode` picks a slim bar in the viewer, a
  floating bar dockable to any edge, or none.
- A command and a keyboard shortcut for every action: page, go to page,
  zoom, fit width or page, find, the PDF Outline, and the selection tools.
- A Select Region tool, for regions over text.
- In Cursor, page, zoom and find buttons in the status bar.
- Removed Copy for Agent (command, title button, context and selection menu
  items) and renamed Ask Agent to **Copy Link for Agent**
  (`pdfWorkshop.copyLinkForAgent` / `pdfWorkshop.copyLinkForAgent.target`;
  no migration). ⌘C / Ctrl+C copies the selected text as plain text (the Copy
  text button is removed). Later Unreleased renames the command to **Copy
  link to this** and makes it clipboard-only (Quote / page link — see above);
  it no longer opens agent chat.
- Experimental agent bridge, **off by default**
  (`pdfWorkshop.agentBridge.enabled`): a local MCP server (127.0.0.1,
  random port, bearer token) that serves the current PDF selection to VS Code
  chat, Cursor, Claude Code and Codex; **PDF: Copy MCP Setup for Claude Code /
  Codex…** connects the last two.

## 0.1.0

First version, moved out of LLM Wiki for VS Code and rewritten:

- PDF viewer on EmbedPDF: continuous scrolling, page and zoom controls, find,
  internal and web links.
- PDF Outline view in the Explorer.
- Copy for Agent for text and region selections, with RFC 8118 page and
  viewrect links and the file's SHA-256.
- PDF: Open Location… for links such as `paper.pdf#page=3&viewrect=…`.
- The viewer reloads when the file changes on disk.
