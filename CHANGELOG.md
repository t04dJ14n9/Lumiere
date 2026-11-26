# Changelog

## Unreleased

- Markdown: a note opens calmly. The Properties sheet's rows (names and
  values, in the sheet's own layout, muted) are on screen from the first
  frame, not a lone "Properties" label over a blank block, and the text
  below does not move when the sheet replaces them, also for long values,
  lists and links. The first-paint snapshot fades into the editor instead
  of cutting to it. Without a snapshot (a restored view, a search match,
  Source mode) the width of the line numbers, change bars and fold markers
  is kept from the first frame, so the text no longer shifts right when
  they arrive; callouts, tables, math, Mermaid and embeds hold their
  place instead of showing raw Markdown; and what loads late comes in once
  over 100 ms, from partly visible, only while the note opens (never when
  scrolling; not at all with reduced motion). No bar the height of the
  properties stands at the top of the note, and the line numbers below the
  sheet no longer shift by a pixel or two when it mounts. Nothing waits for
  any of this: opening is as fast as before.

## 0.1.39 (2026-11-26)

- Markdown: Lumiere is the default editor for `*.md` and `*.markdown`, so
  notes open in it with nothing to set up. `"workbench.editorAssociations":
  { "*.md": "default" }` keeps VS Code's text editor and is no longer taken
  over. The first time Lumiere starts in a workspace, notes already open as
  text (a Codespace's first file, opened before Lumiere started) move into it
  in place; a dirty note, a diff or one opened as text on purpose stays.
- Markdown: the status bar shows the active note's mode (`Live Preview` or
  `Source`; a click switches it), a Vim switch, and a gear that opens Quick
  Settings…: the common switches with their state, then Change Setting…,
  Manage Plugins and Open Settings.
- Markdown: the diagram and image inspector keeps the drawing centred after
  zooming in or out, instead of jumping it to the top left, and still lets
  you scroll to every edge of a drawing larger than the window. Over a
  diagram's labels the pointer is a text cursor, since dragging there
  selects the text.
- A new icon: a typeset capital L made of light, with a spark where the
  beam turns, for notes that render as you write them. `media/icon.svg` is
  its source; `media/icon.png` is drawn from it at 256 pixels.
- Markdown: consecutive footnote references (`[^30][^31]`) read "30,31"
  instead of running together as "3031", in Live Preview and in tables and
  callouts.
- Markdown: Vim's block cursor in a wrapped table cell (or any line whose
  glyphs are as tall as a row, as with CJK fallback fonts) covers one row
  again, not the whole cell.
- Markdown: the selection's corners are square where the cursor meets it,
  as in VS Code, so the cursor sits flush against the tint; the far side
  stays rounded. In Vim's visual mode the tint now meets the block cursor
  with no gap.

## 0.1.38 (2026-11-26)

- Markdown: back and forward arrows on the status bar, as the PDF viewer
  has, while a note is the active tab. They replay jumps within the note
  (headings, footnotes, the outline) and do nothing where there is no jump;
  the title-bar arrows still appear once there is one.
- Markdown: only the Inspect button (⤢ on an image) and Space on a selected
  image open a diagram or image in the larger view; a double-click no longer
  does.

## 0.1.37 (2026-11-26)

- Markdown: the selection has rounded corners, and a selection over several
  lines rounds only its outline. On a list line it starts at the bullet or
  number, not in the indentation in front of it, and Vim's block cursor is
  as tall as the selected row beside it (it was shorter on lines with
  inline code).
- Markdown: User Journey section titles and Event Modeling boxes show their
  labels before Allow; they were blank because the sanitizer dropped
  `<foreignObject>`.
- Markdown: treeView diagrams take the editor's text and line colors, so their
  file names are readable on a dark theme.

## 0.1.36 (2026-11-26)

- PDF agent bridge on Windows: when a folder is added to or removed from the
  window while an agent is reading the bridge's discovery file, the update
  is retried instead of lost, so the agent still finds this window.

## 0.1.35 (2026-11-25)

- Lumiere installs on VS Code 1.101 and later (it required 1.128), so
  editors built on an older VS Code, such as CodeBuddy (1.106), can run it.
  1.101 is the first release with the MCP server API the PDF agent bridge
  registers through.

## 0.1.34 (2026-11-25)

- Markdown: the `sources` property is typed like any other, as in Obsidian,
  so a list of wikilinks there (`- "[[notes/Paper|Paper]]"`) shows as links
  that open, not as YAML text. A list of maps shows as Unknown (JSON), like
  any other property's.
- Copy Link for Agent quotes a note path that has a space,
  `@"/notes/AI 活动/a.md"#20-24`, as Claude Code reads an @-mention (an
  unquoted one ends at the first space); other paths are unchanged.

## 0.1.33 (2026-11-25)

- Markdown: a table fits the note's width and its cells wrap, instead of
  each cell running on one line. Short columns keep their full width; a
  long column narrows to about 12 characters at most before the table
  scrolls sideways. A column whose border you drag keeps that width.

## 0.1.32 (2026-11-25)

- Lumiere follows VS Code's display language. Simplified Chinese (zh-cn)
  is the first translation, of all of Lumiere's own text: commands, settings
  and views, the Markdown editor (menus, properties, tables, embeds, find,
  outline, backlinks, search, graph, Git views) and the PDF viewer (toolbar,
  side panel, notes, prompts and messages). Text written into notes and
  what agents read stay English.
- Copy Link for Agent names a note outside the workspace by its plain path
  even when the path has spaces, `@/notes/AI 活动/a.md#20-24`, instead of a
  percent-encoded `file:///` URI.

## 0.1.31 (2026-11-25)

- Markdown: in Vim's visual mode the block cursor holds still, and the
  selection leaves the cursor's character to it, so moving back to where the
  selection started shows only the cursor.
- Markdown: the selection hugs what is selected: no tint in the gap above a
  heading, and a narrow table is tinted over the table only, not the editor's
  full width.
- Markdown: with line numbers off, the text sits as far from the left edge
  as from the right.
- PDF: the side panel's Annotations list shows when each mark was made, and
  `list_pdf_annotations` returns it as `created`.

## 0.1.30 (2026-11-25)

- PDF: **Toggle Side Panel** is in the viewer's right-click menu, so the
  side panel (thumbnails, outline, bookmarks, annotations) is a right-click
  away in a floating window too.
- PDF: a bookmark made right after jumping to an outline entry is titled
  after that entry, not its parent, and Follow Cursor selects it.
- PDF agent bridge: four read-only tools read a PDF's text with Lumiere's own
  PDFium, so the PDF need not be open: `get_pdf_page_text`, `find_in_pdf`,
  `locate_pdf_quote` and `list_pdf_annotations` (#864).
- PDF: the viewer's engine is EmbedPDF 3.3.0.
- Markdown: a trackpad pinch in the Mermaid inspector zooms in proportion
  to the fingers' movement instead of 15 % per event; a mouse wheel notch
  still zooms by 15 %.
- Markdown: an embedded tweet loads once while a note opens, also on a slow
  machine.

## 0.1.29 (2026-11-24)

- Markdown: in a zoomed-in Mermaid inspector, a drag that starts on a label
  selects its text; a drag on empty space still pans the diagram.
- Markdown: the Mermaid and image inspectors pass VS Code's own shortcuts
  (Ctrl+Alt+B and the rest) to the workbench; they keep only their zoom keys
  and Escape.

## 0.1.28 (2026-11-24)

- Markdown: Clear File Properties no longer turns a `---` block that opens
  the note's text into its properties (#904).
- Markdown: a drag that starts on a wrapped line with hidden markers (a
  heading with inline code) selects from where it started, not from a point
  on the line's other row.
- Copy Link for Agent and the PDF bridge name a local note outside the
  workspace folder by its plain absolute path (`@/notes/赠礼.md#3`) instead
  of a percent-encoded `file:` URI, so agents read Chinese file names as they
  are. A path with spaces, `#` or `%` keeps the URI.

## 0.1.27 (2026-11-24)

- Markdown: text in a Mermaid diagram's labels can be selected and copied
  again once the vault's diagrams are trusted (Allow), when labels are drawn
  as HTML.
- Markdown: without readable line length, the note runs to the pane's right
  edge; the 32 px right margin left an unused strip before the scrollbar.

## 0.1.26 (2026-11-24)

- Markdown: a list, quote, code-block or checklist command refuses when any
  caret or selection end in a table is involved, so a secondary caret in a
  table row no longer changes the table. Those commands and Insert Callout
  also refuse at the end of a table's last row, and the list, quote,
  code-block and checklist commands refuse a selection that runs across a
  table (#829).
- Markdown: removing a note's last property keeps the note's own `---` block
  as text instead of reading it as the properties (#904).
- Markdown: in a read-only editor, the Properties sheet's edits, Enter and
  Shift+Enter list continuation, and the image size keys and Backspace or
  Delete on a selected image no longer change the note (#826).
- Markdown: the rendered diff parses each side's reference definitions once,
  not once per block, with byte-identical output (#871).
- Lumiere PDF: the agent bridge refuses a file argument that names a network
  share (a UNC path or `//host`) before any file-system call, and a folder
  named `..x` under the workspace now matches its window (#919, #921).
- Core: `min()` and `max()` on object or boolean schemas throw where the
  schema is written, instead of rejecting every value (#911). A default that
  is not plain data is refused where it is written (#927). `provide()` refuses
  an undefined value and a name the context answers itself with the new
  `InvalidService` error code (#927).
- Lumiere PDF: Save Annotations into This PDF copies the PDF's bookmarks to
  the new bytes, so the side panel keeps them; the bookmark file for the old
  bytes stays (#884).
- Lumiere PDF: a save into the PDF that meets a reload reports that it did not
  write, instead of leaving the viewer waiting for a result (#896).
- Lumiere PDF: a malformed bookmark entry or a repeated id in a bookmark file
  is kept as written when another bookmark changes, instead of being dropped;
  a bookmark that would not read back is refused (#901).
- Lumiere PDF: a viewer that cannot read a PDF's annotation file leaves it
  alone and says so, and its later saves do not overwrite it (#906).
- Markdown: a vault search no longer ends at a note that is too slow to
  evaluate; that note is skipped and named in the query block's status, and
  the other notes are still searched (#900).
- Markdown: a note written while the vault is first listed is indexed, not
  missed (#898).
- Markdown: a base view shows a nested frontmatter object as its JSON text,
  not `[object Object]` (#926).
- Lumiere PDF: the agent bridge runs only in a trusted folder; in an untrusted
  one, Copy MCP Setup says so and nothing is served until the folder is trusted
  (#920).
- Markdown: a link dropped on a find box or another text field is inserted as
  its text, not claimed by the attachment drop; a file drop is still claimed
  (#902).
- Markdown: a vault search stops at 1000 matching notes and says so, in the
  query block and the Vault Search view, instead of listing every match
  (#925).
- Markdown: a row next to a git-gutter hunk is its context only while it
  matches the base, so a neighbouring change's text no longer goes into the
  hunk's identity (#886).
- Markdown: a table's menu Cut clears its cells only after the clipboard has
  the text, so a clipboard write that fails leaves the cells as they were
  (#888).
- Markdown: Rename Heading also updates the links to the heading in canvases:
  a text node's links are rewritten, and a file node whose subpath names the
  heading takes the new name. Every heading rename reads every canvas once,
  with no time limit (#913).
- Markdown: the editor page takes a message as the extension host's only from
  the host's own window, so a frame in a note (including one removed right
  after it posted) cannot pass as the host (#850).
- Markdown: a panel whose edits the host refuses 8 times in a row (about 30 s)
  stops retrying, turns read-only with the typing kept and says so; a host
  that is only slow is still retried (#897).
- Markdown: a save's two flushes of the open panels share one 1.2 s budget,
  so a panel that does not answer no longer makes the save wait 2.4 s and
  risk VS Code dropping the save listener (#891).
- Markdown: a block link whose `^id` cannot be written to the other note
  links to the note instead, and says why; in the same note, a block that
  changed since the list was made gets no link and a message (#903).
- Markdown: a folder created or moved into a vault is walked only up to the
  listing limit, and a full index refuses new files with the existing
  "more than 50,000" warning (#925).
- Markdown: a vault search stops after ten notes too slow to evaluate and
  says so, as its README already promised, instead of going on for every slow
  note (#900).
- Markdown (Cursor): a Git state change reads only as many changed notes as
  its warm-up cap needs, instead of every changed file (#925).
- Lumiere PDF: a note card closes when its mark is removed while it shows,
  instead of shutting every other note out; a pointer that has left the
  viewer no longer opens a card (#922).
- CI: every GitHub Action is pinned to a full commit SHA, and Dependabot
  updates the composite actions' pins too (#917).

## 0.1.25 (2026-11-23)

- Markdown: Mermaid preparation respects the renderer’s input-size limit, and
  disabling/re-enabling diagrams cannot restore an obsolete theme configuration.
- Markdown: Mermaid defaults follow the editor’s light, dark and
  high-contrast colors, without inverting colors written in a diagram. Diagrams
  are flat, as in Obsidian: no offset shadows, nodes outlined clearly, lifelines
  quieter than messages. Pie slices, Sankey nodes and other category colors use
  the editor’s chart colors, so they can be told apart. Theme changes refresh
  cached diagrams; the inspector uses the same SVG.
- Markdown: regression tests exercise trusted Mermaid labels through the real
  DOM-backed sanitizer, including namespace and unsafe-URL boundaries.

## 0.1.24 (2026-11-23)

- PDF: bookmarks, your own named places in a PDF (#867). **PDF: Add Bookmark**
  (⌘D, Ctrl+D on Windows and Linux) saves the page and the point on it, under
  a title that starts as the outline section you are in (Escape cancels).
  **PDF: Go to Bookmark…** is a Quick Pick of the PDF's bookmarks with rename
  and delete buttons on each; going to one is a jump that Back returns from.
  A **PDF Bookmarks** view in the Explorer, shown only while a PDF is active,
  lists them, with Rename, Delete and Add Bookmark. They are kept beside the
  annotation file, as `<sha256>.bookmarks.json` in
  `lumiere.pdf.annotations.folder`, so the PDF is never written (a PDF in a
  protected folder can have them) and another VS Code window shows a change
  when it lands. MCP tools for bookmarks (#864) come later.
- Agent bridge (MCP): Cursor now starts the bridge's stdio shim through its
  documented `vscode.cursor.mcp.registerServer`, told this window's process
  id. The bridge no longer accepts its token in the URL (`/mcp/<token>`); it
  is read from the `Authorization` header only (#864).
- Agent bridge: a tool's file argument (`open_pdf_location`, `get_pdf_info`,
  `find_notes_citing_pdf`) must name a PDF inside the window's workspace
  folders. A path outside them, through `..` or a symbolic link, is refused,
  and so is a folder named like a PDF. The real path of a folder the window
  opened through a link (`~/vault`) is read as that folder's own.
- Agent bridge: new read-only tools `get_pdf_info` (page count, position,
  bookmarks, hash, protected folder) and `find_notes_citing_pdf` (the notes
  that link to a PDF, with page and quote); `open_pdf_location` says which
  page it opened.
- Agent bridge: `open_pdf_location` no longer disturbs the editor the user is
  typing in. It used to open the PDF as a new tab of the focused group, which
  could hide the note being edited (the keyboard stayed in the hidden note) and
  left an open viewer where it was. A PDF that is already open is now shown
  where it is, and one that is not opens beside the current editor; the
  keyboard focus, the active group and the editor in front stay put. Open PDF
  at Location from a link or the palette is unchanged.
- Agent bridge: `get_ide_context` and the resource `lumiere://ide-context`
  tell an agent where the user is in Lumiere (the active note with its
  selection and headings, the PDF viewed last with its page and selected
  passage or region, and the open Lumiere tabs), which text-editor
  integrations cannot see in a custom editor.
- PDF: a side panel inside the viewer, for a PDF in a floating window (#867).
  A PDF moved with **View: Move Editor into New Window** has no side bar, so
  the PDF Outline in the Explorer is out of reach (reaching it means clicking
  the main window, which makes that window's note the active editor and hides
  the PDF Outline). **PDF: Toggle Side Panel**, and a button in the editor
  title bar (floating windows have one too), show a panel on the viewer's left
  that goes with the PDF: **Thumbnails** (drawn only for the pages in view),
  the **Outline** with Follow Cursor, your **Bookmarks** with Add, Rename and
  Delete, and every **Annotation** in reading order with its colour, the text
  it marks and its note. Each takes the viewer to a place, and Back returns.
  It is hidden at first; it looks like VS Code's own side bar and Panel
  (theme colours, 22 px rows, twisties and indent guides, a sash to resize it,
  the keys of a VS Code list, high-contrast themes). The PDF Outline in the
  Explorer is unchanged: it still shows only while a PDF is active.
- Release workflow: a version published as a Marketplace pre-release is a
  GitHub pre-release too.
- Markdown: a long run of `[[` with no `]]` after it no longer renders in
  quadratic time (a note or diff of 100,000 `[` took 0.3 s, 400,000 took 3.3 s;
  now 0.1 s and 1.0 s).

## 0.1.23 (2026-11-22)

The same extension as 0.1.22, published on the Marketplace as a release
instead of a pre-release.

- Release workflow: the version's heading in this changelog picks the
  Marketplace channel. A heading marked `(pre-release, …)` publishes a
  pre-release, and any other a release. The VSIX is packaged for that channel
  (`pnpm package:release` or `pnpm package:pre-release`), and the release
  stops if the VSIX's own pre-release mark disagrees, since the Marketplace
  takes the channel from the VSIX.

## 0.1.22 (pre-release, 2026-11-22)

- Markdown: a jump to a heading (a click in the Markdown Outline, Go to Heading,
  a `[[#Heading]]` link, a Search match) no longer flickers. The heading was
  painted for a frame or two under the sticky heading bar that appears with the
  jump, then the whole note shifted down by the bar's height. The first scroll
  now leaves room for the bar the heading will have, and what that leaves to
  correct (the bar's row height, a bar that draws late) is corrected before the
  frame is painted, so the first frame shows the heading where it stays (#859).

## 0.1.21 (pre-release, 2026-11-22)

- Markdown: a link to a local HTML file in the vault (`[Open](/wiki/diagram.html)`),
  and the Open button of an HTML embed's card, open the page in VS Code's
  Integrated Browser (`workbench.action.browser.openFile`), where the window has
  one and the workspace is trusted. Open Link to Side opens it beside. Where the
  window has no Integrated Browser (Cursor, an older VS Code), and in Restricted
  Mode, the file opens as text, as before. This replaces the HTML viewer tab of
  0.1.20, which Lumiere no longer draws: its command, `lumiere.markdown.htmlViewer.open`,
  and its setting, `lumiere.markdown.plugins.htmlViewer.enabled`, are gone (#831).
- PDF: a left click on the small note icon by a mark shows the mark's note at
  once. The click used to close the card, so only resting the pointer on the
  icon showed the note. The card stays while the pointer is on the icon or the
  card; a press anywhere else closes it. The icon's pointer is now a hand.

## 0.1.20 (pre-release, 2026-11-22)

Fixes for several VS Code windows, the review bot's findings, Obsidian 1.15.0 parity
(#698, #699, #787) and owner requests: tweet embeds, the HTML viewer, images
showing their source at the caret, axis-locked scrolling. `main` is now the VS Code
and Cursor extension only; the other hosts are on `hosts-snapshot-2026-11-21`.

- Markdown: links to a PDF, an image or another attachment, and links to
  excluded notes, are no longer dimmed as if their file were missing (#698).
- Markdown: the heading, block or match a jump lands on (a link, the
  Outline, Go to Heading, Search) flashes in the highlight colour. The flash
  had no colour, so nothing showed.
- DeepSeek Harness, the desktop app and the web app: a file in a vault can no
  longer run as a page or a script on the editor's origin. The images, audio
  and video a note shows are served as themselves, and sandboxed if opened on
  their own. A PDF is served as itself but not sandboxed: Chrome refuses to
  show a sandboxed PDF, and its viewer runs on an origin of its own. Anything
  else (an HTML page, a script) is served as a download. A note's page runs
  only its own scripts (by nonce) in DeepSeek Harness and the desktop app, and
  the desktop app's tabs frame it in a sandbox that stops it navigating the
  window or starting downloads. The page still shares the window's origin
  (#744).
- Markdown outside VS Code (DeepSeek Harness, the app, the desktop app):
  Undo and Redo work. Each note keeps its own steps, a run of typing undoes
  at once as in VS Code, and a save keeps the steps. Another program's
  change to the note is one step: Undo takes it back first (#743).
- Markdown: Obsidian's default editor keys work where VS Code and Cursor
  leave them free in a note: Mod+/ toggles a comment, Mod+L a checkbox (not
  in Cursor, whose chat has the key), Mod+Alt+Enter opens the link at the
  caret to the side, and on macOS Cmd+Option+F opens Replace. Keys that
  already do something here (Mod+D, Mod+E, Mod+O, Alt+Enter, Mod+Enter) are
  left alone; CAPABILITIES.md lists each (#699).
- Markdown: the find bar's match shows the Markdown around it in Live
  Preview, as Obsidian's search highlight does, now also on a footnote
  reference or an image, which otherwise stay rendered under a selection
  (#699).
- Markdown: a note keeps its folds, as Obsidian keeps them per file.
  Reopening the note, opening it in a second panel or reloading the window
  shows the headings and lists folded as they were left. Two open panels
  keep their own folds; the note keeps those of the panel last folded in,
  so editing or closing the other panel does not undo them (#698).
- Markdown: a foldable callout starts as its note says (`-` closed, `+`
  open) whenever the note loads, as in Obsidian, which keeps no record of
  it. Reloading the window no longer brings back callouts opened or closed
  before; a toggle still lasts while the panel is open, and through a
  rename (#698).
- Markdown: `[[^^` offers every block in the vault, not only those that
  already have an `^id`, as in Obsidian. Picking one without an id gives it
  one (six hex digits) at the end of the block, in this note or the other.
  The block being typed in is not offered (#698).
- Markdown: drag a heading in **Markdown Outline** to move its section, with
  its subheadings, as in Obsidian's Outline. Dropped on a heading, the
  section goes before it; dropped below the last heading, to the end of the
  note. One Undo takes the move back (#699).
- Markdown: **Rename Heading…** is in a note's right-click menu on a heading
  line, as Obsidian's editor menu offers it, in VS Code and outside it. It
  renames the heading and updates the links to it (#699).
- Markdown: **Search Vault…** searches the vault with Obsidian's search
  syntax (the one `query` blocks use) and lists the matching notes and their
  lines in the Explorer's **Vault Search** view, as Obsidian's search pane
  does. Click a line to open the note there; the results follow edits
  (#699).
- Markdown: while you edit a `$$` formula, the formula stays typeset just
  after its source, below it when the `$$` have their lines to themselves
  and inline otherwise, as in Obsidian; it follows your typing. With the
  note unfocused the formula stays rendered. This reverses the source-only
  reveal of #269 (#698).
- Markdown: **Fold All** and **Unfold All** also collapse the note's
  Properties, as in Obsidian, where Unfold All does not expand them either.
  In Source mode, or with Properties shown as YAML, **Toggle Fold
  Properties** folds and unfolds the front matter (#787).
- Markdown: **Follow Link**, **Open Link in New Tab** and **Open Link to
  Side** also follow a reference link (`[text][label]`, `[text][]`) through
  the note's definition, and search the vault for a tag at the caret, as
  Obsidian's commands do. Their keys are unchanged (#787).
- Markdown: `-` on a selected image shrinks it down to 20 px, as in
  Obsidian, rather than stopping at 25 px (#787).
- Markdown: sorting a table by a column compares the text each cell shows,
  as Obsidian does, not its Markdown: `[[Note|Zed]]` sorts as "Zed" and
  `**b**` as "b" (#787).
- Markdown: link suggestions, the quick switcher and the other fuzzy
  pickers ignore accents, as Obsidian 1.15.0 does: `cafe` finds `café`, and
  a query typed with an accent puts the notes that have it first (#787).
- Markdown: Backlinks sorts note names by their numbers, as Obsidian does:
  "Note 2" comes before "Note 10" (#787).
- Markdown: in Vim mode `gc` no longer toggles a comment. Obsidian's Vim has
  no `gc`; Mod+/ still toggles one (#787).
- Markdown: Rename Heading… accepts any name, as Obsidian does, `#`, `|`, `^`,
  `[` and `]` included. Links to the heading get the name as Obsidian writes
  them (those characters as spaces) and still reach it. A link to a heading
  with a `%` in its name, such as `[[Note#100% done]]`, now reaches it
  (#787).
- Markdown: **Insert Current Date** and **Insert Current Time**, Obsidian's
  Templates commands, write the date or time in the Templates formats at the
  caret (no keys, as in Obsidian). Template variables match in any case:
  `{{Title}}` and `{{DATE:YYYY}}` are filled in like `{{title}}` and
  `{{date:YYYY}}` (#787).
- Markdown: Obsidian's quick switcher keys work in Lumiere's Quick Switcher:
  Mod+Enter opens the note in a tab that stays open, Mod+Alt+Enter opens it
  to the side, Shift+Enter creates a note with the typed name and
  Mod+Shift+Enter creates it in a new tab. They apply only while the
  switcher is open. With nothing typed, it also lists the images, PDFs and
  other attachments recently opened from it, as Obsidian does (#787).
- Markdown: bold, italics, strikethrough, highlight (and its colours), inline
  code and inline math wrap a selected line's text after its list, quote,
  task or heading marker, and leave the spaces at the selection's ends
  outside, as Obsidian 1.15 does; a selection running over a table, code
  block or math block skips its lines (#787).
- Markdown: Set Heading, the list, quote and checklist commands, Insert Code
  Block, Insert Math Block and Insert Callout include the line a selection
  ends at the start of, as Obsidian 1.15 does, whichever way it was made
  (#787).
- Markdown: Toggle Blockquote quotes the blank lines of a selection too, as
  Obsidian does, so a blank line among quoted ones is quoted instead of the
  others losing their quote (#787).
- Markdown: with several carets or selections, Set Heading, the list, quote
  and checklist commands, Insert Link, Insert Wikilink, Insert Embed, Insert
  Horizontal Rule, Insert Code Block and Insert Math Block act at every one,
  as in Obsidian; they used only the main one (#787).
- Markdown: Swap Line Up and Down move a list item with the items and lines
  under it while Smart lists is on, as Obsidian 1.15 does: past its sibling,
  out of its parent upwards and into the next item downwards, numbers
  staying in place (#787).
- Markdown: a highlight coloured with a square emoji (`==🟥text==`, and
  🟧🟨🟩🟦🟪) shows in its colour, in the note and in embeds, as Obsidian
  1.15 reads it; the colour commands treat it as that colour (#787).
- Markdown: the link keys and clicks are Obsidian 1.15's. With the caret in
  a link, Alt+Enter follows it, Mod+Enter opens it in a new tab (the note
  stays open) and Mod+Alt+Enter to the side; they also follow reference
  links and search a tag, and work in table cells. Mod-click and a middle
  click open a link in a new tab, Mod+Alt-click to the side; a plain click
  still reveals the link's source. Page Preview loses Alt+Enter: it opens on
  a Mod-hover or with **Preview Link at Caret** in the Command Palette
  (#699).
- The desktop app, the web app, the iPad app and the DeepSeek Harness
  integration left `main`, which is now the VS Code and Cursor extension
  only (owner decision, 2026-11-21). They live, frozen, on the
  `hosts-snapshot-2026-11-21` branch (commit `db1a5aaf`), which takes no
  further changes from `main`. The entries above that name them describe
  that branch, not this release.
- Markdown: the Sketches plugin (drawing with Apple Pencil in a note) and
  the `packages/ink` it drew with left `main`. It ran only in the iPad,
  desktop and web apps, which provided a canvas; in VS Code and Cursor it
  never started, but its setting `lumiere.markdown.plugins.sketch.enabled`
  ("Draw with Apple Pencil in a note…") still showed in the Settings editor.
  The setting and the hidden Insert Sketch command are gone; a value left in
  settings.json is dimmed as unknown, and a `*.sketch.svg` file still shows
  as an image. The plugin lives on the `hosts-snapshot-2026-11-21` branch.
- Markdown: the note's right-click menu offers Rename Heading… on a heading
  far down a long note, before the editor has parsed that far.
- Markdown: the caret on an image shows its source again, as Obsidian 1.12
  did, and the image stays shown: below the source when the image is alone
  on its line, right after it in a line of text. It hides again when the
  caret leaves. A click still selects the image for `+`, `-`, `0`, Enter,
  Tab and Delete, now with its source shown, a double-click still opens
  the inspector, and the arrow keys move through the source instead of
  selecting the image (owner request).
- Markdown: sorting a table from a cell you are editing orders that cell by
  its shown text like every other row. With the caret in a cell such as
  `**z**`, **Table: Sort Ascending** compared its Markdown, so it sorted
  before `a`; it now sorts after it, as from the header (#808).
- Markdown: a `$$` formula in a line of text that the caret is in shows its
  source and its preview as soon as Live Preview starts in an editor that
  already has the focus. It stayed typeset until the caret moved (#809).
- Markdown: Rename Heading to a name with formatting, such as
  `New [[Target|Alias]]` or `[Label](url)`, writes links to the heading as
  it shows (`#New Alias`), so they reach it; they were written with the
  name as typed and led nowhere. A name no link could reach (only
  formatting, `L12`) is refused (#811).
- Markdown: with Vim on, in Insert mode, Cmd+Option+F on macOS opens Replace
  instead of deleting the character before the caret. Only Ctrl+H
  deletes backward there.
- Markdown: dragging a heading in **Markdown Outline** while another writer
  edits the note (or another program rewrites it) no longer moves a
  different heading. A drop is refused, with the message to try again, once
  the outline has refreshed to a changed note since the row was picked up
  (#818).
- Markdown: Follow Link, Open Link in New Tab and Open Link to Side (Alt+Enter,
  Mod+Enter, Mod+Alt+Enter) on a reference link in a table cell open its
  destination. The cell's editor held only the cell, so a definition written
  below the table (`[r]: https://example.com`) was not found (#822).
- Markdown: a tweet written as an image, `![](https://x.com/user/status/ID)`
  (or twitter.com, or a mobile. address), now embeds as in Obsidian: the tweet
  shows in the note in the VS Code theme, sized to its content. In an
  untrusted workspace it shows a card with an Open button and loads nothing.
  YouTube links are not embedded, though Obsidian embeds them: VS Code's
  webview sends no referrer, and YouTube's player answers Error 153. Removed,
  because Obsidian has none: the Spotify, SoundCloud, Vimeo, Hugging Face and
  npm cards, every Bilibili card (video, bangumi, UP space and live room), and
  the YouTube video, playlist and channel cards, with their title and cover
  lookups and the setting `lumiere.markdown.onlineVideos.bilibiliPlayer`. Links
  to those sites are plain images, which fail to load. A Bilibili player is
  tracked in #835.
- Markdown and PDF: a trackpad or wheel scroll that is nearly straight up and
  down, or sideways, now scrolls along that one axis, as VS Code's editor
  does; a clearly diagonal one still pans freely. Over a wide table, a
  vertical gesture scrolls the note and no longer nudges the table sideways,
  and a sideways one scrolls the table. It follows `editor.scrollPredominantAxis`
  (on by default; turn it off to scroll every gesture freely) and is decided
  once for a whole gesture, momentum included, so a swipe does not change
  axis in the middle. Pinch and Ctrl, Cmd and Shift wheels are untouched
  (owner request).
- PDF agent bridge: a window starting no longer removes the discovery file of
  another window that started at the same moment, which left an agent unable
  to find that window. The sweep that clears a crashed window's file could,
  if the crashed window's port had been given to the other window and its
  file written in between, remove that new file. Each window's file now has
  a name of its own, `<port>-<pid>-<random>.json`; a file an earlier version
  named `<port>.json` is still read and swept (#830).
- Markdown: a link to a hidden file, such as `[peek](.hidden.md)`, opens the
  file its preview shows. With a `.hidden.md` both in the note's folder and
  at the vault root, the preview showed the one beside the note and a click
  opened the root's. A click and a preview now look in the same places, in
  the same order (a bare name beside the note, then at the vault root), and
  a click makes a note only when neither has the file. A click on a bare
  link to another kind of file, such as `[x](image.png)`, now opens the
  vault root's file when none is beside the note; it did nothing (#823).
- Markdown: a link to a heading of the note it is in (`[jump](#Part)`),
  inside a hidden note such as `.raw/captured/page.md` that an embed or a
  preview showed by its path, now previews its heading. It said "Resource
  not found", because the vault index skips hidden folders and has no
  entry for the note the link is in (#824).
- Markdown: Insert Code Block and Insert Math Block with several carets or
  selections on one line put one block around the line, instead of two empty
  blocks with the text left outside them (#810). Insert Math Block, Toggle
  Inline Math, Insert Wikilink, Insert Embed, Insert Callout, Insert
  Footnote, Insert Table and the table commands, the checklist commands, Add
  file property (Mod+;), Add alias and Clear file properties no longer
  change a note whose editor has turned read-only after it stopped syncing
  (#812). Neither do tables in such a note: a cell no longer opens, an open
  cell takes no typing or formatting, and table commands, sorting, the
  table clipboard and moving rows or columns write nothing.
- Markdown: a link to a local HTML file in the vault (`[Open](/wiki/diagram.html)`)
  opens the page in a tab of its own, in a trusted workspace, instead of the
  file's source. The tab is a webview whose page is the file, with the file's folder
  as its base, so relative styles, scripts and images load from the vault; the
  extension listens to nothing it posts. In Restricted Mode, and when the HTML
  Viewer plugin is off, the file opens as text. An HTML file embedded in a note
  (`![[diagram.html]]`, `![alt](/wiki/diagram.html)`, an `html-embed` block, with
  the size syntax of the Embed HTML and HTML Embed community plugins) shows a card
  with Open and Open as Text, not the page: VS Code does not serve a vault file to a
  frame in the editor. docs/PARITY.md, "Community plugin compatibility", lists
  each difference (#831).

Fixes for several VS Code windows open at once, each with a test; checked
with two real windows on one profile.

- PDF agent bridge: an agent finds the window of a folder opened through a
  link (such as anything under `/tmp` on macOS), and the window a folder was
  added to while the bridge ran. A window that closes takes its discovery
  file with it, a crashed window's file goes even when its process id is
  taken again, and an agent's next call after its window reloads reaches the
  new bridge; after its window closes it is told no window has its folder.
- PDF: a pane that saves nothing new no longer writes over marks another
  window made a moment before.
- Markdown: a passage attached in Codex by Copy Link for Agent keeps its file
  when another window copies one with the same name.

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
