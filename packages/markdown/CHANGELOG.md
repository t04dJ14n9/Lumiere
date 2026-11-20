# Changelog

## 0.1.0 (unreleased)

- A Markdown link into a hidden folder, such as
  `[source](/.raw/captured/page.md)`, now previews and embeds its file. A
  click already opened it, but the hover preview said "Resource not found":
  the vault index skips hidden folders, and only the click looked on disk.

- Leaving a note or PDF no longer moves the keyboard focus to restore VS
  Code's Outline. The restore focused the Outline in the main window's side
  bar and then the active editor group, a moment after the reader had left;
  with an editor moved into a new window, and more so over Remote-SSH, it
  could take the focus from the window the reader had just clicked into.

- **Always Update** in the link update prompt still updates the links when
  the setting cannot be saved (a settings file with errors), and a message
  says why. The failed save used to drop every link edit of that rename.

- Text inside a rendered callout (or HTML block) can be selected by
  dragging, and copied, as in reading view. A drag used to collapse into a
  caret at the callout's start, revealing its source, or the selection
  vanished when the mouse was released. A plain click still opens the
  callout's source.

- Jumping to a heading from the Outline, Go to Heading or a link no longer
  flashes another part of the note first. When an image above the heading
  loaded after the jump, one frame showed the note pushed down by the
  image's height, and the next showed the sticky headings of the section
  above; both now settle before the frame is drawn.

- Fixed (Obsidian compliance audit, 2026-11-16):
  - Renaming a note to a name with `'` or `"` no longer breaks the
    frontmatter of notes that link to it from a property. The new link is
    escaped for the value's quoting, and a plain value that cannot hold it
    is written double-quoted. A property link to a name with an apostrophe
    in a single-quoted value (`'[[Bob''s]]'`) now resolves and follows
    renames.
  - With the relative link format, a link written into a folder (by a
    rename, a suggestion or an inserted link) that a root file of the same
    name would capture gets `./` in front (`[[./X]]`, `[x](./X.md)`), so it
    opens the note in that folder instead of the root one. Markdown link
    suggestions get the same check, which ignores case as links do.
  - **Insert Template** merges a template's properties into the note's, as
    Obsidian does, instead of pasting its `---` block into the note: the
    note's values stay, missing properties are added and lists are joined.
    Only the body goes in at the caret. Joining a list the note writes as
    a block list (`- a` lines) adds the new items as `- ` lines and keeps
    its comments, instead of rewriting it as `[a, b]`; an object in both
    lists is written once. A variable that would make the
    template's properties invalid YAML (`title: {{title}}` for a note named
    `[draft] plan`) is written quoted in its value. A template whose
    properties are still not valid YAML gets only its body inserted, never
    its `---` block, and the message names the template; the message about
    a note's invalid properties names the note. Inserting into a note that
    ends at its closing `---` puts the body on a new line instead of
    joining it to the `---`.
  - **Always Update** in the link update prompt now writes
    `lumiere.markdown.linkUpdates.mode: always` to the note's workspace
    folder settings (`.vscode/settings.json`, or the workspace's when the
    note is in no folder) instead of your user settings, so it applies to
    that vault only, as Obsidian keeps `alwaysUpdateLinks` per vault.
    Known limitations: the choice is kept per workspace folder, not per
    vault, so several vaults inside one folder share it; and a user-level
    `always` written by an earlier version is not migrated, so it stays
    (and applies to every vault) until you remove it.
  - Renaming or moving a note or attachment now updates `.canvas` files:
    file nodes follow the file, and links in text nodes are rewritten.
  - A rename no longer skips notes the vault index has not parsed yet (a
    large vault's first start): their text is read and rewritten too, and
    a message names any that could not be read in time. A note or canvas
    that cannot be read or parsed is named in that message too, instead of
    making the whole rename fail and leaving every link unchanged, and the
    message shows even when the prompt is skipped because no other note
    changes. Unparsed notes and canvases share one 20-second reading
    budget across the prompt's count and the rewrite (each note is read
    once), so a rename stays inside VS Code's participant timeout.
  - A property link in a note with Windows (CRLF) line endings is rewritten
    by a rename; the note's frontmatter was also read as body text, and the
    link counted twice was dropped.
  - A note you type in while the rename runs is no longer edited at
    positions computed from its earlier text: it is left as it is and
    named in the "Links … were not updated" warning. Canvases are covered
    too.
  - A callout written with an alias (`[!tldr]`, `[!faq]`) keeps that type in
    its `data-callout` attribute, as Obsidian does, so CSS snippets that
    select `[data-callout="tldr"]` apply. Its icon and colour are still
    those of the main type.
  - Template dates (`{{date:FORMAT}}`, `templates.json` formats) and Bases'
    `format()` write Moment's common tokens: `MMMM` is the month's name
    (it was `1111`), and `MMM`, `dddd`, `ddd`, `Do`, `YY`, `A`/`a`, `h`,
    ISO weeks, `L`/`LL` and `[literal]` text work. A `templates.json`
    format is no longer dropped when it has a token Lumiere cannot write;
    Insert Template names that token instead, and so does a Bases embed
    whose `format("…")` uses one. `Y`, `YYY`, `GGGGG` and Moment's `\`
    escape work, and ISO weeks and the day of the year are right for years
    0 to 99.
  - Embedding a block (`![[Note#^id]]`) whose id is on a list item shows
    the item with its bullet and nested items, not only its text. An id on
    a heading embeds that heading instead of the whole note, and an id
    inside a quote or callout embeds the whole quote instead of a mangled
    piece of it. Ticking a child task in such an embed ticks it in the
    source note, and children indented with a mix of tabs and spaces stay
    nested.
  - A `%%` comment block that spans blank lines or holds headings, lists or
    tables is one comment, as in Obsidian: it is hidden in rendered
    Markdown (embeds, previews, exports), dimmed in Live Preview, and its
    headings no longer appear in the Outline, heading suggestions or
    heading links. Links and tags inside stay indexed, as Obsidian indexes
    them. A `%%` line that nothing closes comments out the rest of the note,
    or of the quote, callout or list item it is in (in the editor too, which
    used to run on past the quote). A `%%` line right below a paragraph
    line starts the comment instead of joining the paragraph, so a closed
    comment there no longer hides the rest of the note; it still closes a
    `%%` the paragraph opened. Text after a comment's closing `%%` on its
    line is shown and its links, tags and block ids are indexed. A `%%` line
    under a nested list item is a comment in the editor as it is in reading
    view.
  - Properties read the vault's `.obsidian/types.json`: a property Obsidian
    types as Text shows as text even when its value is `123`. Lumiere does
    not write `types.json`: a type you change in Lumiere is stored in
    Lumiere only (it wins over `types.json` for that property), and
    Obsidian does not see it.

- Daily Notes is removed: **Open Today's Daily Note**, **Open Previous
  Daily Note** and **Open Next Daily Note** are gone, with the
  `lumiere.markdown.plugins.dailyNotes.enabled`,
  `lumiere.markdown.dailyNotes.folder`, `dailyNotes.dateFormat` and
  `dailyNotes.template` settings, and Lumiere no longer reads
  `.obsidian/daily-notes.json`. Your daily notes stay where they are and
  open like any other note. **Insert Template** and `templates.json` are
  unchanged. VS Code ignores settings no extension declares, so values you
  set for the removed ones do nothing and need no migration.

- **Keep Marp Deck in Workshop** is now **Keep Marp Deck in Lumiere**, and
  the Marp and Outline settings' descriptions name Lumiere instead of
  Workshop, the editor's old name. The command id is unchanged.

- With Vim on and the mode in the VS Code or Cursor status bar, dragging to
  select text no longer scrolls the note on every mouse move, and `gg` and
  `G` keep the caret in view. The closed Vim line under the note was only
  hidden, and the editor still made room for it as if it covered the whole
  note; it is now removed until a prompt or message opens it.

- Fixed (review 2026-11-15):
  - Editing a table no longer deletes cells past the header's column count
    on rows you did not edit.
    Deleting the header, or moving such a row to the top, widens the table
    to that row instead of turning the table into plain text.
  - Pasting, dropping or downloading an image, or saving a sketch, never
    overwrites an existing file of the same name; it takes the next free
    name.
  - Scratch note file names use your local date instead of the UTC date.
  - A formula or code block with a broken character, or a malformed
    `data-math` / `data-source` in raw HTML, no longer stops the rest of the
    note from rendering.
  - Closing the Vault Graph releases the panel's listeners, and clicking a
    node opens its note even while the graph refreshes.
  - Copy Link for Agent puts the passage on the clipboard when VS Code's chat
    opens but refuses it, and stops re-attaching to Codex once the plugin
    stops.
  - Clicking a heading in the Markdown Outline of a CRLF note no longer makes
    the outline ignore the caret for a second.
  - Notes outside the workspace, or whose path differs in letter case on
    Windows and macOS, open from Outline, Backlinks and the graph. Outline
    and Go to Heading say at once when the Links plugin is off for the note,
    and a jump that goes nowhere is logged instead of failing silently.

- OKF support is removed. A folder with an `index.md` and typed notes is no
  longer an OKF bundle, so a Markdown link starting with `/` resolves from
  the vault root everywhere, as in Obsidian: `[x](/wiki/notes/x.md)` from a
  note under `wiki/` opened nothing before. Renaming a note no longer writes
  bundle-absolute links. The graph draws a whole vault (**Choose Vault for
  Graph** replaces the bundle picker), keeps `index.md` and `log.md`, and
  drops the **Conformant only** filter and `sources` edges. `generated` and
  `verified` maps show as Obsidian's Unknown type. The
  `lumiere.markdown.okfCore.bundles` setting is gone.

- With Vim on, the mode (`-- NORMAL --`, `-- INSERT --`, …) shows in the
  VS Code or Cursor status bar instead of a line under the note. That line now
  opens only for a `:`, `/` or `?` prompt or a Vim message.

- A heading link starting with `/` in VS Code's own text editor
  (`[x](/wiki/notes/x.md#flags)`) now opens from the vault root, the
  nearest folder with `.obsidian`, as in Obsidian and in the Lumiere view.
  It used to start at the workspace folder, which missed the note when
  that folder is above the vault.

- The Wiki plugin is removed: no more `.wiki/layout.json` reading, wiki
  page diagnostics, **Copy Wiki Reference for Agent**, **Copy Wiki Bridge
  Envelope**, **Show Wiki Layout** or **Refresh Wiki Diagnostics**. With it
  go **Promote Scratch Note** and **Move Marp Deck Outside Bundle**; **New
  Scratch Note** always uses `lumiere.markdown.scratch.folder`. The bridge
  envelope no longer has a `wiki` field. **Copy link to this** and **Copy
  Bridge Envelope** are unchanged.

- Typing `[[` in VS Code's own text editor now suggests links, as the Lumia
  editor does: `[[Note` lists notes (with aliases), `[[Note#` the note's
  headings, `[[Note#^` its blocks that already have an id, and `[[Note|` keeps
  the note offered while an alias is typed. It uses the same index, ranking and
  insertion text, so the two agree, including with Use Wikilinks off; picking
  an entry finishes the link with `]]`. This is for vaults whose notes open as
  text (`"workbench.editorAssociations": {"*.md": "default"}`). Blocks without
  an id and tags are not suggested there.

- Page preview on hover needs Mod (Cmd or Ctrl) for links rendered in
  tables, callouts and embeds too, as it already did for Live Preview
  wikilinks and as Obsidian's editor does. A plain hover over those links
  popped a preview.

- The graph's **Orphans** toggle means what Obsidian's does: on (the
  default) shows notes with no links, off hides them. The old "only
  orphans" mode is removed, not renamed: the graph has no way to show
  only orphans now. A panel saved with that filter ignores it and opens
  with all notes.

- CSS snippets load only when `.obsidian/appearance.json` lists them in
  `enabledCssSnippets`, as in Obsidian. A vault with no `appearance.json`
  (or no list in it) loaded every `.css` file in `.obsidian/snippets/`.

- Markdown links (`[label](Missing.md)`) inside an embedded note are dimmed
  when they do not resolve, as wikilinks there already were; an embed with
  no wikilink was skipped.

- The rename dialog offers **Always Update**, as Obsidian's does: it
  updates the links and sets `lumiere.markdown.linkUpdates.mode` to
  `always`. The edits are now built after the answer, so a note edited
  while the dialog is open is rewritten as it is then. The dialog counts
  the notes from the vault index instead of rewriting every one of them
  first, so asking does not eat into VS Code's rename-participant timeout.

- Renaming a note waits (up to five seconds) for the vault index to finish
  parsing queued notes before it looks for links to update, so a link
  typed or synced just before the rename is updated too.

- An ambiguous link (`[[x]]` with several `x.md` in the vault) resolves as
  Obsidian resolves it: matches under the note's folder first, then the
  rest, each by shortest path rather than nearest folder. From
  `notes/daily/today.md`, `[[x]]` with `notes/x.md` and `y/x.md` opens
  `y/x.md`. Rename link updates use the same order, so they no longer
  retarget such a link.

- Heading links match the way Obsidian matches them: heading text without
  case, with punctuation such as `/`, `:` and `?` read as spaces, so
  `[[Note#A B]]` reaches `## A/B`. `[[Note#A#B]]` finds a deeper heading B
  after A, not only A's direct child. Block ids (`#^id`) match without case.
- Heading links also accept GitHub's slugs, as written for GitHub or VS Code:
  `[x](Note.md#use-postgres)` reaches `## Use Postgres`, and repeated
  headings are reached with `-1`, `-2`. Obsidian itself opens such links at
  the top of the note. Lumia still writes heading links the Obsidian way.

- Opening a note no longer swaps the sidebar for the Explorer. The first note
  opened in a window (from Search, Quick Open or anywhere else) used to focus
  Markdown Outline, which brought up the Explorer over the Search view you were
  using. Markdown Outline now shows itself where the Explorer is already
  showing, hides VS Code's native Outline when it does, and the native Outline
  comes back when you leave the note only if Lumia hid it. VS Code lists an
  extension's Explorer views collapsed the first time, so expand Markdown
  Outline once; VS Code remembers it.

- **Use Lumia for Markdown in This Workspace** now associates `*.md` and
  `*.markdown` with Lumia itself instead of VS Code's text editor (the route
  from #458, which reclaimed every note into Lumia). VS Code hands a note to
  Lumia directly: a cold open shows the note about 75 ms sooner (no text
  editor tab first). A workspace set up the old way is moved over on
  activation. A Search result still opens with its match selected.

- A Search result, Markdown Outline click, Go to Heading or heading link now
  leaves its target on screen when the note opens or the jump comes soon after
  it: the target is held at the top of the viewport, below the sticky
  headings, while the features that load after the first paint (the sticky
  bar, tables, callouts, line numbers) change the heights around it. Before,
  on a short note the match could land under the sticky bar, and on a long one
  the scroll could stop hundreds of lines short, leaving the match below the
  viewport.

- Notes open faster in VS Code: the page asks for the chunks of the first
  view (Properties, line numbers, tables, callouts, links and the rest of what
  a note shows first) together with the editor script instead of one after
  another, and the editor script itself is one file instead of 55. On a
  small note the features are in place about 50 ms sooner, on a 5,000-line
  note about 70 ms, and on a note with 100 properties about 170 ms.

- Markdown Outline in the app clears its highlighted row when the caret or the
  top line is above the first heading (frontmatter or a preamble), as Obsidian
  does, instead of leaving the last section marked. VS Code's tree view has no
  way to clear a selection, so there the last row stays marked.

- Markdown Outline no longer stays on the row you clicked when you scroll on to
  another section within the second after the click and stop: the last scroll
  position held back during that second is applied when it ends.

- Markdown Outline keeps the heading you jumped to selected after Go to
  Heading, a `[[#Heading]]` link or a sticky-heading click, as it does for an
  outline click. Near the end of the note, where the jump cannot put the
  heading at the top, the section above no longer takes over. Scroll follow
  also reads below the sticky headings and the embedder's top controls, so a
  nested heading just under its pinned parents is the one selected.

- Markdown Outline keeps the caret's section selected when the caret scrolls
  the note: arrowing past the bottom, Page Down, Ctrl+End and find next no
  longer have the section at the top of the viewport take over about 100 ms
  later. Only scrolling the reader does follows the top line.

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
