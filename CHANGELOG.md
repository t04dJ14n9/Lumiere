# Changelog

## 0.1.19 (pre-release, 2026-11-20)

- PDF: notes on marks are Markdown. Rest the pointer on a highlight,
  underline, strikeout or squiggly mark that has a note, and the note shows
  in a card drawn like VS Code's hovers, with working web links; a small icon
  marks the marks that have one. **Edit Note…** writes the note in that card,
  in a multi-line field, instead of a one-line prompt, and **Highlight with
  Note** highlights the selected text and opens its note to write (#778).
- Markdown and PDF: leaving a Lumiere editor brings VS Code's Outline back
  without taking the keyboard focus, which could pull it out of an editor in
  another window (#777).
- Markdown: a Markdown link into a hidden folder, such as
  `[source](/.raw/captured/page.md)`, now shows its file in the hover preview
  and in an embed. A click already opened it, but the preview said "Resource
  not found" (#779).

## 0.1.18 (pre-release, 2026-11-20)

Fixes from a full code review (#775), each with a test.

- Markdown: text after a closing `$$` on a later line of a formula is kept;
  typing while images are imported no longer drops the paste.
- Markdown: large notes and vaults are faster. Inserting a table row redraws
  only its cells, a note is not hashed again on every edit, `.base` embeds
  send a tenth of the data, embeds load as they come near the screen, and
  listing a vault reads only what it needs first.
- Markdown: Ctrl/Cmd+E switches from the text editor to Lumiere only in a
  `.md` or `.markdown` file, not in diff editors, untitled files or notebook
  cells.
- PDF: annotations saved in another window show up in this one; a PDF engine
  that stops working says so and offers Reload; files over 512 MB are
  refused; a PDF embed turns pages without reopening the file; the context
  sent to an agent includes the selected region's image.
- Windows: Git features find a note's repository however Windows spells the
  folder (a short name such as `RUNNER~1`, or another case).
- App and desktop (preview): the file tree can create, rename, move and
  delete (to the system trash), and draws only the rows in view; the window
  shows at once; Git asks before it runs in a vault and blocks hooks; on
  Windows the server starts without a console window, and a save waits for a
  program that briefly holds the note open.

## 0.1.17 (pre-release, 2026-11-19)

- PDF: the right-click menu on selected text shows **Highlight**,
  **Underline**, **Strikeout** and **Squiggly** side by side; the **Mark
  Text** submenu and **Add Annotation…** are gone (use **Copy link to this**
  to hand the text to an agent). **Edit Note…** on a mark is unchanged.

## 0.1.16 (pre-release, 2026-11-18)

- Markdown: an open note is saved 2 s after your last edit, as in Obsidian
  (`lumiere.markdown.editor.autosave`, on by default; it steps aside when
  VS Code's own `files.autoSave` is on).
- Markdown: three Obsidian settings Lumiere can honour.
  `links.focusNewTab` (off keeps the focus in the note when a link opens in a
  new tab or to the side), `vault.showUnsupportedFiles` (the Quick Switcher
  lists every file) and `attachments.deleteUnlinkedAttachments` (when you
  delete a note in VS Code, offer to delete the attachments only it used).
- Markdown: **Download Attachments for Current File** shows a checklist of the
  images to download, names files from the server's `Content-Disposition`,
  downloads image URLs in properties too, skips responses that are not images
  and reports them, and never overwrites an existing file.
- Markdown: Insert Callout, Toggle Checklist Status and Cycle List Checklist
  do nothing inside a table cell; Insert Callout follows Obsidian's rule for
  wrapping a line or inserting at the caret; Clear Formatting leaves a plain
  `[[Page]]` link alone.
- Markdown: a rename whose Always Update choice cannot be saved still updates
  its links, and says why the choice was not kept.
- Markdown: the Git diff view pairs each changed block with the one it most
  resembles and splits lists into items, as VS Code does.
- PDF: zooming no longer flashes a page blank for a frame on a slow machine:
  a page keeps its picture until the zoomed one is ready.
- PDF: **Save Annotations into This PDF** no longer loses annotations made
  while it writes, saved by an overlapping write, or brought back by Undo, and
  never writes over a newer PDF it was not shown.
- DSH and the Lumiere app: an outside change to a note with unsaved typing is
  merged into it instead of being overwritten by the next save; where both
  changed the same lines, the other version is kept in `Note (conflict).md`.
  Files are written and read only after checking they are inside the
  workspace, and a page can no longer make the host trust a folder (a note
  opened by absolute path from outside every registered workspace is
  refused).

## 0.1.15 (pre-release, 2026-11-18)

- Markdown: drag across a rendered callout's text to select it, and copy
  it; the selection no longer collapses into the callout's source.
- PDF: annotate from the context menu; the Annotate button, mode, tool and
  colour pickers are gone. Select text and right-click for **Highlight**,
  **Add Annotation…** (a highlight with a note you type) or **Mark Text** ▸
  Underline, Strikeout, Squiggly. Right-click one of your marks for **Edit
  Note…**, **Change Color** ▸ and **Delete Annotation**. As in macOS Preview,
  ⌃⌘H highlights, ⌃⌘U underlines and ⌃⌘S strikes out the selected text
  (Ctrl+Alt+H / U / S on Windows and Linux); ⌃⌘A / Ctrl+Alt+A no longer
  does anything. Ink, shapes, text boxes, notes and stamps can
  no longer be drawn; ones you made before still show, and their context menu
  recolours or deletes them.

## 0.1.14 (pre-release, 2026-11-17)

- PDF: the status bar shows the history back/forward, previous/next page,
  zoom and find buttons in VS Code too, not only in Cursor
  (`lumiere.pdf.toolbar.statusBarButtons: auto`; `never` hides them).
- Copy Link for Agent writes an `@` locator, a blank line, the quoted
  selection and a newline. From a PDF the locator is `@papers/a.pdf#page=3`
  instead of a Markdown link, so a pasted copy no longer makes a backlink
  overlay; **PDF: Open Location…** reads the locator.

## 0.1.13 (pre-release, 2026-11-17)

- Code block Copy buttons now briefly show **Copied** with a success animation
  after the clipboard write succeeds.

## 0.1.12 (pre-release, 2026-11-16)

- Fixed (Obsidian compliance audit, 2026-11-16): property links survive
  renames to names with quotes, relative links name the right note, Insert
  Template merges properties, **Always Update** is kept per vault, and
  renames update `.canvas` files and notes the index has not read yet.
  After review: a note that cannot be read no longer stops a rename, notes
  typed in during a rename are not edited at stale positions, `%%`
  comments end where Obsidian ends them, child tasks tick through block
  embeds, and templates keep the note's properties valid. Known
  limitations: **Always Update** is kept per workspace folder (vaults
  sharing a folder share it), and a user-level `always` from an earlier
  version is not migrated. Details in `packages/markdown/CHANGELOG.md`.

- Daily Notes is removed from Lumiere's Markdown editor, with its three
  commands and four settings; VS Code ignores the settings now that nothing
  declares them, so no migration is needed. Templates stay. See
  `packages/markdown/CHANGELOG.md`.

- Fixed (review 2026-11-15), in DSH, the app and the plugin core:
  - Opening a note by absolute path in DSH no longer locks its session's
    workspace out until DSH restarts.
  - When a note changed on disk while you were typing, your text is saved
    and the other version is kept beside it as `Note (conflict).md`, instead
    of being overwritten silently.
    Typing done while that save checks the disk is kept too; before, a
    note that was clean when the save started took the other version over
    it.
    A save that cannot read the file to make that check fails, instead of
    writing over it.
  - A note no longer shows up, or gets saved, empty when a file watcher fires
    in the middle of Lumiere's own save.
  - HTML, SVG and script files in a vault can no longer run on DSH's or the
    app's origin.
  - A listener failing while the host handles a file change or a closed note
    is logged instead of becoming an unhandled rejection.
  - Shutting down no longer briefly restarts a plugin whose optional service
    stops first, optional settings with a minimum, maximum or pattern may be
    left unset, and a setting's default can no longer be changed by mutating
    a parsed value.
  - Markdown and PDF fixes are listed in `packages/markdown/CHANGELOG.md` and
    `packages/pdf/CHANGELOG.md`.

- Mermaid diagrams: Inspect, Copy and Edit are now three equal buttons, evenly spaced and flush with the right edge (Inspect shows its name instead of a small ⤢). The `mermaid` label sits in that corner and gives way to them on hover or keyboard focus.

- Fixed: Vim `j`/`k` could skip several source lines inside a revealed Mermaid diagram or other source-visible Live Preview block.

- **Lumia is now Lumiere.** The Extensions view, the Marketplace listing
  (**Lumiere: Obsidian-style Notes and PDF Reader**), **Reopen Editor With…**,
  the Command Palette (**Lumiere: …**), the Settings UI and messages say
  Lumiere. The extension id, commands and `lumiere.*` settings are unchanged.

- Lumia: `[[paper.pdf#` suggests the PDF's bookmarks, and picking one
  inserts `[[paper.pdf#page=5|Methods]]` (`[Methods](paper.pdf#page=5)` with
  wikilinks off), which opens that page.
- Lumia PDF: Chrome-aligned Copy link Quotes and vault Markdown backlink overlays; sidecar highlight create removed (legacy `#hl-` open kept). Regions / `viewrect=` opt-in (`lumiere.pdf.regions.enabled`, default off). Details in `packages/pdf/CHANGELOG.md`.
- Lumiere PDF is rebuilt on EmbedPDF 3: more exact text geometry, no zoom flicker, rotated pages in Markdown PDF embeds. Wheel and pinch zoom are EmbedPDF's (a notch zooms by 1.2), annotation files are version 2 (older ones are converted when read), dark paper still works, and the extension is larger (a 7.9 MB PDF engine). Details in `packages/pdf/CHANGELOG.md`.
- **Lumière is now Lumia.** Its name in the Extensions view, **Reopen
  Editor With…**, the Command Palette (**Lumia: …**), the Settings UI and
  its messages says Lumia, and so does Lumia PDF. The extension id
  (`t04dJ14n9.lumiere`), command ids and `lumiere.*` settings are unchanged,
  so an installed copy updates in place and keeps its settings and
  keybindings.

- **Lumière for iPad (preview)**: the same window on the iPad, over the
  app's own folder and folders picked in Files, with no server (`apps/ipad`).
  On a narrow screen the note takes the whole width and the files or the
  outline float over it. More… in the edit menu opens Lumière's right-click
  menu, and the keyboard stays down until you tap the note. PDFs open in
  tabs in Lumière's PDF viewer, in the web app too, and a note's images,
  videos and embedded PDFs show. One tap is enough on the editor's
  buttons. The window takes Liquid Glass: the note runs edge to edge
  under floating glass capsules and panels.
- **Lumière desktop and the web app**: a lighter tab bar, with tabs as soft
  pills. Plugins that need what the app cannot give them (Git, VS Code)
  are off there.
- **Lumière for the web (preview)**: the desktop app's window in a browser,
  with no server and offline (`apps/web`). Open a folder of your own
  (Chromium) or keep notes in the browser; it comes back where you left it.
  The same host runs in the iPad app next (`packages/host-web`).

- **Lumière desktop (preview)**: Lumière's editor in a window of its own, in
  the spirit of Typora (`apps/desktop`, Tauri), laid out as VS Code: the
  vault's files on the left, the note's outline on the right, notes in tabs.
  Settings opens as a tab (⌘,), with search, as VS Code's Settings editor.
  Color Theme follows the system or stays light or dark. ⌘W closes the
  shown tab while others are open, ⌃⇥ goes back to the last tab, and
  ⇧⌘] / ⇧⌘[ step through them. ⌘B and ⌥⌘B hide the files and the
  outline. Open Folder… uses the native picker, and
  Markdown files open from Finder or the command line. Unsaved notes are written when you quit. The same window
  also runs in a browser (`packages/app`). PDFs open in tabs in Lumière
  PDF's viewer, from the files, Finder or the command line.
- Outside VS Code (the desktop app, DeepSeek Harness), right-clicking in a
  note shows Lumière's menu as in VS Code: Copy Link for Agent with text
  selected, formatting and highlight colours, then Cut, Copy and Paste.
- **DeepSeek Harness**: Obsidian settings in `.obsidian/app.json` now apply,
  including when the folder is created after the vault opens.
- Fixed outside VS Code: the host could not stop while a note's page was
  open.

- **Toggle Text Editor** (Ctrl/Cmd+E): after switching Lumière ↔ the host text
  editor, close the leave-behind sibling tab of the same file so only one tab
  remains (BH-011 / BH-003). Dirty tabs are left alone.
- **DeepSeek Harness**: Lumière's Markdown editor runs in DeepSeek Harness
  0.2.1 or later, as a DSH plugin (`packages/dsh`): notes open in Lumière in
  DSH's preview sidebar and save as you type. Paths that leave the workspace,
  including through `..` or a symbolic link, are refused. PDFs, Git features
  and the side views stay VS Code and Cursor only for now.
- Fixed: Current-line authorship (gitBlame) could throw "Disposed: gitBlame
  is stopped" into the editor while the plugin restarted.

- **Toggle Text Editor** (Ctrl/Cmd+E): switch the active Markdown note between
  Lumière and the host's built-in text editor. Deliberately not Obsidian's
  Live Preview ↔ Source binding; that remains the unbound Toggle Live
  Preview/Source Mode command. Selection/caret are not restored across the
  switch.

- Renamed to **Lumière: Markdown Editor and PDF Reader**, extension ID
  `t04dj14n9.lumiere`. Settings, commands, views, context keys and editors
  move from `markdownWorkshop.*` and `pdfWorkshop.*` to `lumiere.markdown.*`
  and `lumiere.pdf.*`; the Markdown editor is shown as "Lumière", the PDF
  reader as "Lumière PDF", and the output channel is "Lumière". Settings under
  the old names are not carried over: set them again under the new ones, and
  uninstall `t04dj14n9.vscode-workshop`, which would claim the same files.
  The IDE context packet keeps its `product` values (`markdownWorkshop`,
  `pdfWorkshop`), so agents that read it need no change.
- Open Settings and Change Setting no longer freeze Cursor's window for 15
  to 75 seconds (Markdown and PDF). The Settings editor is opened without
  sending it back to the extension.
- Markdown Workshop and PDF Workshop ship as one extension, `t04dj14n9.vscode-workshop`,
  with custom editors for both `.md` and `.pdf` files. Their histories are in
  `packages/markdown/CHANGELOG.md` and `packages/pdf/CHANGELOG.md`.
- Every plugin runs on `@workshop/core`, built on Cordis; the previous
  in-house kernel, the PDF plugin runtime and its Cordis shim are gone, as is
  the `pdfWorkshop.runtimeImpl` setting.
- One output channel, "Workshop", for both products.

## 0.1.1

- Marketplace icon at `media/icon.png`.
- Get started points at the VS Code Marketplace listing (`t04dJ14n9.lumiere`)
  and Extensions search, instead of a VSIX-only install.
