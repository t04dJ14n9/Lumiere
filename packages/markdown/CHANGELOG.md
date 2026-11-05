# Changelog

## 0.1.0 (unreleased)

- The rename dialog offers **Always Update**, as Obsidian's does: it
  updates the links and sets `lumiere.markdown.linkUpdates.mode` to
  `always`. The edits are now built after the answer, so a note edited
  while the dialog is open is rewritten as it is then.

- Renaming a note waits (up to five seconds) for the vault index to finish
  parsing queued notes before it looks for links to update, so a link
  typed or synced just before the rename is updated too.

- An ambiguous link (`[[x]]` with several `x.md` in the vault) resolves as
  Obsidian resolves it: matches under the note's folder first, then the
  rest, each by shortest path rather than nearest folder. From
  `notes/daily/today.md`, `[[x]]` with `notes/x.md` and `y/x.md` opens
  `y/x.md`. Rename link updates use the same order, so they no longer
  retarget such a link.

- Markdown Outline (and Go to Heading / in-note fragment jumps that share
  links `navigate`) put the jumped heading at the **top** of the editor
  viewport, not the vertical centre. The browser still clamps at both ends of
  the note.

- Markdown Outline no longer flashes shut and open while scrolling into a
  section that only needs more rows open: a follow that is superseded mid-way
  (common with reading-position reports) keeps the accordion's open-branch
  model when it did not collapse the tree, so the next follow does not run
  Collapse All. Leaving a chapter still collapses and can still flash, as in
  #485.

- Markdown Outline no longer flashes shut and open after each pause in
  typing: the rows the accordion opened stay open across the refresh an edit
  makes. Follows also change the tree one at a time, so a quick move from one
  chapter to another no longer leaves the first one open.

- Markdown Outline no longer flashes shut and open when the reading position
  moves into a section that has subsections: it collapses the tree only when
  a branch that is open must close (leaving a chapter, or a section with
  subsections), and otherwise just opens the rows it needs.

- Markdown Outline follows scrolling as well as the caret, like a page's
  table of contents: the section being read (the line at the top of the
  editor viewport while scrolling; the caret on selection changes) is
  selected, its parents and subheadings open and every other branch closes.

- Properties: a `tags` list (and any list) shows every item, as Obsidian
  does, instead of three and a **Showing 3 of N** button
  (`properties.listPreviewCount` now defaults to 0, off). `sources` is no
  longer clamped to three lines: it shows up to 300 px and scrolls past
  that. OKF `generated` and `verified` are editable in place, as YAML text
  that reads like any other value, instead of read-only chips; an edit
  keeps the map.

- Lumière is now called Lumia wherever it shows: the editor's name in
  **Reopen Editor With…**, command titles, settings titles and messages.
  Ids (`lumiere.*` commands and settings, the `lumiere.markdown.editor`
  view type) are unchanged.

- Double-clicking a heading in the Markdown Outline goes to that heading
  again. The first click's jump re-applied the accordion, collapsing the
  rows around it, so the second click landed on another heading and went
  there. A click in the outline now leaves the tree as it is.

- Live Preview and the editor parse a note once instead of twice: Live
  Preview now reads CodeMirror's syntax tree. Jumping around a large note no
  longer re-parses 100,000 characters each time (script time over four
  scrollbar jumps in an 835 KB note: about 330-400 -> 90-100 ms).

- Dragging a selection from the start of a heading takes its `#` marks, as
  in Obsidian; the marks were hidden when the drag began, so the selection
  started after them.

- Opening an image or PDF over a note (`code image.png` in a terminal, Quick
  Open, a double-click) opens it again, instead of closing it and inserting
  it into the note. For an Explorer drop without Shift, which VS Code opens
  the same way, a prompt offers **Add to Note**.

- Large notes scroll and take typing faster. On an 835 KB, 30,000-line note
  (Chromium, browser harness): the worst frame when reading on 533 -> 200 ms
  and when scrolling straight after opening 470-670 -> 100-200 ms; script time
  scrolling down 30-50% lower; typing 166 -> 55 ms a key. List lines no
  longer scan the whole note on every screen, footnotes no longer compute
  the note's whole metadata (or parse it whole while it is still loading),
  and a word typed outside headings, footnotes and embeds no longer makes
  sticky scroll, line numbers, footnotes and embeds walk the whole note.

- Table columns resize by dragging their border, in any row, as the
  resize cursor and a guide line show. The handles were a few pixels inside
  the header cells, so pressing the border did nothing. Widths are no longer
  written to the note (Obsidian keeps none): they last while the note is
  open. A `<!-- lumiere-col-widths: … -->` line written before is an
  ordinary comment now, and can be deleted.
- A table in a list item keeps all its rows (they used to end it after the
  header), and editing or resizing it keeps it in the item.

- Dragging a selection out past the top or bottom of a note in VS Code now
  keeps scrolling until the pointer comes back, and selecting on the last
  visible line no longer nudges the note.

- On macOS, **Look Up** in a note's right-click menu opens the word you
  right-clicked in the Dictionary app, as in Lumière PDF. It works whatever
  the trackpad's Look Up gesture is set to.

- Dark Mermaid diagrams use Obsidian's invert of the default palette
  (`invert(100%) hue-rotate(180deg) saturate(1.25)`), including the diagram
  inspector. Light (`vscode-light`, `vscode-high-contrast-light`) stays the
  default Mermaid palette. Flowchart and sequence height reserves no longer
  shrink when the pane is narrower than the diagram.

- Obsidian-style attachments: drop or paste images (including screenshots and
  remote/data images in rich HTML paste) into `files.attachmentFolder` under
  `YYYY-MM-DD HH.mm.ext` names with wikilink / Markdown embeds. Sketch placement
  shares the same core. Import Asset / `assets.path` removed.

- Smoother scrolling through Mermaid diagrams in Live Preview: a diagram
  draws as it comes within a screen of view, as in Obsidian, instead of
  showing its source until you stop scrolling, and the text around it moves
  far less when it draws (its height is guessed from the diagram's shape
  first). Wheel and trackpad scrolling no longer waits for the editor to
  start, and blocks scrolling in and out no longer lay the page out once
  each.

- Ctrl+G Go to Line works in Live Preview / Source again: the chord no longer
  shows VS Code's "Open a text editor first…" on the custom editor (Host GUI
  BH-033).

- With Vim on, Ctrl/Cmd+V pastes and Ctrl/Cmd+C copies a selection again:
  capture-phase ownership runs clipboard paste/copy over vim-core's `<C-v>`
  block-visual and `<C-c>` Esc maps (Host GUI BH-032).

- With Vim on, Ctrl/Cmd+W closes the active editor again: capture-phase
  ownership runs host close over vim-core's `<C-w>` window prefix (Host GUI BH-031).

- Selecting a `|W` wikilink image no longer draws a long caret/selection bar
  below the card: the block paint reserve is released after measure, and the
  caret is hidden while the image is selected (Host GUI BH-007).

- Inline math on a list item's first line renders in Live Preview; it was
  blank, or drawn over the text before it.
- Math that needs MathJax's on-demand glyphs renders offline: `\mathbb`,
  `\mathfrak`, `\mathscr`, `\mathsf`, `\mathtt`, `\ell`, `\Re`, `\perp`,
  `\leadsto`, `\checkmark` and many AMS symbols failed with "dynamic file …
  failed to load", and `\mathcal` and accented letters in `\text` were drawn in
  the wrong font.

- **Keep Marp Deck in Workshop** now uses the command ID
  `markdownWorkshop.marp.keepInWorkshop`. Product copy uses Workshop throughout.

- The heading tree is now **Markdown Outline**, with **Toggle Markdown Outline**
  in the command palette. Existing command IDs, settings and shortcuts stay the same.

- cursorBridge: in Cursor, Cmd/Ctrl+L opens Chat and Cmd/Ctrl+K opens Edit on
  the Live Preview selection (native Cursor apply). A handoff lease suppresses
  reclaim for the whole native Edit session; selection offsets are
  version-checked after warm/open. Disabled bridge restores Insert Link.

- Renamed from Markdown Workbench. The package name is
  `vscode-markdown-workshop`; settings and commands use `markdownWorkshop.*`.
  There is no compatibility alias. The display name stays **Markdown Workshop**
  (Marketplace, custom editor, command category, settings UI title, and other
  user-visible strings).

- Tables: the open cell and rectangular selections draw an inset accent
  selection box again. Opening a cell used to clear `.table-cell-selected`, and
  CSS `outline` was clipped by `.table-scroll` overflow.

First packaged build, for the owner's acceptance testing. Not published.

- Wiki, assets, scratch and Marp plugins, plus a versioned bridge
  envelope (`docs/bridge-envelope.md`). Copy Wiki Reference for Agent and
  Copy Bridge Envelope do not start an agent. Import Asset writes into the
  configured assets folder only when you import. Scratch notes stay outside
  the bundle until Promote Scratch Note. Marp decks preview and export
  through VS Code and Marp for VS Code; a deck inside the wiki bundle is
  not wrapped into a page. Agent PDF Viewer stays a separate extension.

- Opening a target in a note (a Markdown Outline click, a Backlinks entry, a
  same-note `#heading` link or a link from another note) scrolls it to the vertical centre of the editor, as VS Code's Outline and
  Obsidian's do, instead of to the nearest edge; near the start or end of a
  note it stays as close to the centre as the note's scroll range allows.

- Review fixes (round 1): the Copy Link for Agent plugin is now
  `agentBridge` (`markdownWorkshop.plugins.agentBridge.enabled`; the command
  and `markdownWorkshop.copyLinkForAgent.target` keep their names); plugin
  start-up rolls back on failure and shutdown runs in reverse order; Live
  Preview redraws only the blocks an edit or caret move affects; selection
  state reaches the extension in batches. The handoff text format is shared
  with Agent PDF Viewer (`docs/agent-handoff-format.md`).

- Live Preview editor for Markdown, as a custom editor beside VS Code's
  text editor, sharing one document, save and undo.
- Plugins, each with a switch: properties, inline title, links, embeds,
  page preview, tables, callouts, math, diagrams, code blocks, footnotes,
  tasks, tags, suggestions, search query blocks, outline, backlinks,
  outgoing links, quick switcher, word count, link updates on rename,
  folding, line numbers, indentation guides, spellcheck, auto-pairing,
  smart lists, formatting commands, Vim, HTML paste and Copy Link for Agent
  about Selection.
- Vault index that resolves links like Obsidian, with a saved snapshot for
  instant start-up.
- Commands: **Manage Plugins**, **Show Plugin Status** and **Use Markdown
  Workshop for Markdown in This Workspace**.
- Logging to the **Markdown Workshop** output channel;
  `markdownWorkshop.debug.logging` adds debug lines.
- Public API v1 for other extensions: editors, selections, vault queries,
  plugin catalog and states, and external plugins with markers, actions,
  link handlers and code block processors. See API.md.
