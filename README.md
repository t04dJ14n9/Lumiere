# Lumiere: Obsidian-style Notes and PDF Reader

Lumiere is an Obsidian-style Live Preview Markdown editor, plus a fast PDF
reader, inside VS Code and Cursor. Its aim is a better Markdown editor for
VS Code that keeps the good properties of Obsidian: notes render as you type,
`[[wikilinks]]` resolve the way Obsidian resolves them, and embeds, callouts,
properties, an outline, a graph, backlinks and a quick switcher are there.

**Try it in your browser:** open the
[sample vault in GitHub Codespaces](https://codespaces.new/t04dJ14n9/lumiere-sample-vault?quickstart=1).

## Why

Obsidian's editing experience is the reason people keep notes in Markdown.
It is also a separate application. Lumiere brings that experience into the
editor where you already work, so notes sit beside everything VS Code gives
you:

- Git, with change bars and rendered diffs for notes.
- Agents such as Claude Code, Codex, Cursor's chat and VS Code chat, with
  links that point an agent back to the exact lines of a note or the exact
  page of a PDF.
- Terminals, tasks and the extensions you already use.
- Remote development (SSH, Dev Containers, Codespaces): VS Code runs the
  extension on the machine that holds your files.

Lumiere is not Obsidian and does not cover all of it. Read
[Differences from Obsidian](#differences-from-obsidian) before you move a
vault over.

## Features

### Writing

- **Live Preview.** Formatting renders in place and its syntax shows only
  around the caret or selection. **Toggle Live Preview/Source Mode** (or the
  `lumiere.markdown.editor.defaultMode` setting) switches a note to Source
  mode. VS Code keeps the text, saving and undo; a note saves two seconds
  after your last edit while it is open in Lumiere, as in Obsidian.
- **Obsidian's Markdown.** Wikilinks, embeds, callouts, tags, `==highlights==`
  (including coloured ones), `%%comments%%`, footnotes, math, block ids and
  task lists, parsed by one grammar shared by the editor, the index and the
  renderers.
- **Rich blocks.** Tables you edit as a grid (cell selection, row and column
  commands, sorting, TSV paste), foldable and nested callouts, MathJax,
  Mermaid diagrams (following the VS Code theme), and code blocks with syntax
  highlighting and a Copy button.
- **Properties.** An editor for a note's front matter with typed fields:
  text, list, number, checkbox, date, date and time, tags and aliases.
- **Obsidian's editing keys.** While a note has focus, Ctrl/Cmd+B, I, K
  (insert link), `/` (comment), L (checklist) and `;` (add property) do what
  they do in Obsidian; in Cursor, K and L open its Edit and Chat instead.
  Also smart lists, paired brackets, heading and formatting commands, extra
  carets, an in-note find and replace bar, rich-text paste as Markdown, and an
  optional Vim mode (off by default).
- **Attachments, templates and scratch notes.** Dropped or pasted images are
  saved into your attachment folder with Obsidian-style names and linked;
  **Insert Template** reads a templates folder; **New Scratch Note** makes a
  temporary note.
- **Layout.** Line numbers, folding of headings and lists (kept per
  note), sticky parent headings, indentation guides, a note font size you set
  apart from the code editor's, and the host's spellchecker.

### Linking and navigation

- **Links like a vault's.** `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`
  and `[[Note#^block]]` resolve by Obsidian's rules (case-insensitive, `.md`
  optional, `./` and `../` from the note's folder, other paths from the vault
  root). Links to notes that do not exist yet are dimmed, and following one
  creates the note.
- **Suggestions as you type** for notes, aliases, headings, blocks, tags and
  the sections of a PDF (`[[paper.pdf#`). The `[[` suggestions also work in
  VS Code's own text editor.
- **Following.** Alt+Enter follows the link at the caret, Ctrl/Cmd+Enter
  opens it in a new tab and Ctrl/Cmd+Alt+Enter beside; Ctrl/Cmd-click and a
  middle click open a new tab. Ctrl/Cmd-hover previews the target. **Go Back
  in Note** and **Go Forward in Note** return to the last places you jumped
  from.
- **Renames update links.** Rename or move a note or attachment in VS Code
  and links to it are rewritten in other notes (it asks first by default;
  `lumiere.markdown.linkUpdates.mode` changes that). **Rename Heading…**
  updates links to a heading.
- **Vault tools.** A **Quick Switcher** over notes, aliases and unresolved
  links; **Markdown Outline** and **Go to Heading…** (Ctrl/Cmd+Shift+O) in
  the Explorer, where you can drag a heading to move its section; a **Tags**
  view; **Search Vault…** with Obsidian's search syntax, and `query` blocks
  that show live results in a note; **Open Vault Graph**, global or local.
- **Backlinks and Outgoing Links** views in the Explorer, with unlinked
  mentions. Both are off by default; turn on
  `lumiere.markdown.plugins.backlinks.enabled` and
  `lumiere.markdown.plugins.outgoingLinks.enabled`.

### Embeds

- Notes, headings and block ids (`![[Note#Heading]]`, `![[Note#^id]]`).
- Images (with sizes, keyboard resizing and a viewer), audio and video.
- PDFs: one page inline (`![[paper.pdf#page=3]]`) with page buttons and an
  Open button that opens the PDF in Lumiere PDF.
- Obsidian Bases files (`![[tasks.base]]`) as table, card or list views.
- Tweets written as images (`![](https://x.com/user/status/ID)`), in a
  trusted workspace.
- A local HTML file is shown as a card whose Open button opens the page in
  VS Code's Integrated Browser.

### Your vault as it is

- A folder with `.obsidian/` is a vault; without one, the workspace folder is.
  Lumiere reads the vault's `.obsidian` settings for link format, new-note and
  attachment folders, excluded files, property types, templates and the
  enabled CSS snippets. A value you set in VS Code wins over the vault's.
- One index of the vault (headings, blocks, links, tags, properties) is built
  in a worker thread and saved in workspace storage, so a reopened window
  starts warm.
- Git: change bars beside the line numbers against `HEAD` or the index (on by
  default, for a file in a Git repository). Clicking a bar opens a peek with
  the hunk's unified diff and **Revert**; Alt+F5 and Shift+Alt+F5 move between
  changes. There is no hunk staging. **Open Rendered Git Diff** shows two
  versions of a note rendered side by side, and setting
  `lumiere.markdown.gitDiffEditor.diffEditor` to `rendered` makes Source
  Control and the Timeline use it. Inline track changes and the author of the
  caret line are available but off by default.

### PDF

- **A reader built on [EmbedPDF](https://www.embedpdf.com/)** and the PDFium
  engine, running in a worker. Single pages or two-page spreads, continuous
  or page-by-page, vertical or horizontal, zoom and fit, find, internal and
  web links. Page, zoom and view controls sit in the status bar and the
  editor's title bar.
- **Bookmarks as an outline** in the Explorer, following the page you read.
- **Your own bookmarks.** Add Bookmark (⌘D, Ctrl+D) saves a place under a title,
  Go to Bookmark… returns to it, and a PDF Bookmarks view in the Explorer lists
  them. They are kept beside the annotations, never in the PDF.
- **A side panel in the viewer.** Thumbnails, the outline, your bookmarks and
  the annotations in a panel that goes with the PDF, so a PDF in a floating
  window still has them (**PDF: Toggle Side Panel**).
- **Annotations.** Select text and right-click for Highlight, Underline,
  Strikeout, Squiggly or a highlight with a note written in Markdown. Marks
  are kept outside the PDF, under `.lumiere/pdf-annotations/`, and the PDF
  changes only if you run **Save Annotations into This PDF**.
- **Backlinks from notes.** A note's link to `paper.pdf#page=3#:~:text=…`
  paints a passage highlight on that page; clicking it opens the note.
- **Reloads in place.** When a paper is rebuilt on disk, the reader comes back
  at the same page and zoom.
- Dark paper that follows the theme, Zen mode, and macOS Look Up.

### Agents

- **Copy link to this.** In a note it copies an `@notes/a.md#12-18` link to
  the selected lines and the passage quoted under it (a note with unsaved
  changes asks to save first, so the lines match the file). In a PDF it copies
  `@papers/a.pdf#page=3` and the selected text. Both formats are defined once
  in [packages/agents](packages/agents/docs/agent-handoff-format.md).
- **Straight into the chat, if you want it.** For notes,
  `lumiere.markdown.copyLinkForAgent.target` sends the passage to Cursor's
  chat, VS Code's chat, Claude Code or Codex. The default, `auto`, opens a
  chat only when the editor's own chat is the only agent installed, because an
  extension cannot see which agent you use. A PDF's Copy link only copies.
- **Open Copied Agent Reference** opens the lines that the `@path#lines`
  reference on your clipboard names, and the PDF's **Open Location…** opens
  the page that a pasted locator or link names.
- **IDE context.** **Copy IDE Context** and **Send IDE Context to Agent…**
  build a packet (the active note or PDF, the selection, open tabs,
  diagnostics) for Claude Code and Codex.
- **Cursor.** In Cursor, Cmd/Ctrl+L and Cmd/Ctrl+K in a note open Chat and Edit
  on the selection.
- **PDF selection over MCP** (experimental, off by default): a local server
  that lets an agent ask for the PDF selection. Run **PDF: Copy MCP Setup for
  Claude Code / Codex…** to connect.
- **A public API (v1)** for other VS Code extensions: markers, actions, link
  handlers and code block renderers ([packages/markdown/API.md](packages/markdown/API.md)).

## Install

1. Install [Lumiere](https://marketplace.visualstudio.com/items?itemName=t04dJ14n9.lumiere)
   (`t04dJ14n9.lumiere`) from the VS Code Marketplace, or search for **Lumiere**
   in the Extensions view. Each version is published to the Marketplace as a
   release or a pre-release (its CHANGELOG heading says which), and each
   [GitHub release](https://github.com/t04dJ14n9/Lumiere/releases) attaches the
   `.vsix` for **Extensions: Install from VSIX…**. `code --install-extension`
   and Codespaces install the release channel.
2. Open a folder of notes. An existing Obsidian vault works as it is.
3. Run **Use Lumiere for Markdown in This Workspace** from the Command Palette,
   so `*.md` files in that folder open in Lumiere. It is an option rather than
   the default, so it does not take over every README you open.
4. Open a PDF. If another PDF extension opens it first, use **Open With… ›
   Lumiere PDF**.

Lumiere runs in a Node extension host, so it does not run in VS Code for the
Web (vscode.dev, github.dev).

Lumiere was briefly called Lumia. The extension id (`t04dJ14n9.lumiere`), its
commands and its `lumiere.*` settings never changed, so an installed copy
updates in place and keeps its settings.

### In Cursor

Cursor has its own Markdown editor, with a **Preview | Markdown** switch in
the editor's corner. Once Lumiere is the workspace's Markdown editor, notes
that Cursor opens in its text editor come back to Lumiere, while diffs, Git
views and anything you open with **Open as Text** stay as they are
(`lumiere.markdown.editor.reclaimTextEditor`). Cursor keeps most extension
buttons in the editor's **…** menu, so the PDF reader's page and zoom controls
live in the status bar.

## Settings

Markdown settings start with `lumiere.markdown.` and PDF settings with
`lumiere.pdf.`, and each product has its own commands. **Lumiere: Open
Settings** opens VS Code's Settings editor filtered to the Markdown settings,
and **PDF: Open Settings** to the PDF ones. **Lumiere: Change Setting…** and
**PDF: Change Setting…** list that product's settings in the Command Palette,
grouped, and edit the one you pick by its type (a list or
an object opens the Settings editor on that setting).

- **Every feature is a plugin you can switch off:**
  `lumiere.markdown.plugins.<id>.enabled`, for example `tables`, `graph` or
  `vim`. **Manage Plugins** opens Settings on those switches and **Show Plugin
  Status** lists the active note's plugins with their state.
  `lumiere.markdown.preset` set to `minimal` loads only the core
  plugins, so notes open in Source mode.
- **Three editor defaults differ from Obsidian's on purpose.** Readable line
  length is off (`lumiere.markdown.editor.readableLineLength`), the inline
  title is off (`lumiere.markdown.plugins.inlineTitle.enabled`) and line
  numbers are on (they follow `editor.lineNumbers`). Turn the first two on and
  line numbers off for Obsidian's look.
- **Other settings you will meet first:**
  `lumiere.markdown.editor.fontSize` and `.lineHeight`,
  `lumiere.markdown.links.useWikilinks` and `.newLinkFormat`,
  `lumiere.markdown.files.attachmentFolder` and `.newNoteFolder`, and
  `lumiere.pdf.view.*` for the reader's default zoom, layout and scrolling.
- Off by default: Backlinks, Outgoing Links, Vim, inline git changes, git
  blame and, in the PDF reader, the Select Region tool
  (`lumiere.pdf.regions.enabled`).

## Differences from Obsidian

Lumiere uses Obsidian 1.15.0 as its behaviour reference and never copies its
code, styles or assets. What it does not do, or does differently, on purpose
or not yet:

- **No Reading view.** A note is either in Live Preview or in Source mode.
  Ctrl/Cmd+E switches between Lumiere and VS Code's own text editor, in both
  directions, instead of toggling Reading view.
- **HTML pages are not drawn in a note.** An embedded or linked `.html` file
  opens in VS Code's Integrated Browser where the window has one, and as text
  in Restricted Mode, in Cursor and in older VS Code. The embed is a card with
  Open and Open as Text, because VS Code does not serve a vault file to a
  frame inside a webview.
- **A plain click on a rendered link reveals its source** rather than
  following it. Ctrl/Cmd-click or Alt+Enter follows it.
- **Embeds that differ.** A PDF embed shows one page, not Obsidian's whole
  viewer; YouTube links are not embedded (VS Code's webview sends no referrer,
  and YouTube answers Error 153).
- **Native views, not panes.** The outline, backlinks, tags and search results
  are Explorer views. Search Vault… has no sort or match-case controls, and
  there is no Dataview. The graph refuses a vault of more than 2,000 notes or
  20,000 links instead of sampling it, and has no 3D view.
- **Footnote references** are superscript numbers in the paper style, not
  Obsidian's.
- **Not implemented:** Reading view, Canvas, bookmarks, Publish and Sync.
- **No community plugins or themes.** Colours follow the VS Code theme and the
  `.obsidian` CSS snippets you have enabled load. Extensions to Lumiere are VS
  Code extensions that use its API.
- **Keys.** Obsidian's Ctrl/Cmd+O (quick switcher) and Ctrl/Cmd+D (delete
  paragraph) are left to VS Code, and Ctrl/Cmd+K and L in Cursor stay
  Cursor's. The quick switcher and Delete Paragraph are in the Command Palette
  for you to bind. The full list is in
  [packages/markdown/CAPABILITIES.md](packages/markdown/CAPABILITIES.md#hotkeys).
- **Git and virtual workspaces.** Change bars, blame and rendered diffs need a
  repository on disk. Notes and PDFs still open and save through VS Code's file
  system in a virtual workspace.

Every row of the comparison, with how it was checked and on which Obsidian
version, is in [packages/markdown/docs/PARITY.md](packages/markdown/docs/PARITY.md).
Automated checks do not establish visual parity, and many rows there are
marked as not yet compared by hand.

## Learn more

| For | Read |
| --- | --- |
| What each Markdown plugin does and where it differs from Obsidian | [packages/markdown/CAPABILITIES.md](packages/markdown/CAPABILITIES.md) |
| The PDF reader in depth: controls, annotations, agent bridge | [packages/pdf/README.md](packages/pdf/README.md) |
| How the system is built | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| The Markdown editor's design | [packages/markdown/DESIGN.md](packages/markdown/DESIGN.md) |
| Writing a plugin for Lumiere as a separate extension | [packages/markdown/AGENT.md](packages/markdown/AGENT.md), [packages/markdown/API.md](packages/markdown/API.md) |
| Changes between releases | [CHANGELOG.md](CHANGELOG.md) |
| Working on this repository (contributors and coding agents) | [AGENTS.md](AGENTS.md) |

## Develop

```sh
pnpm install
pnpm build          # dist/: extension.js, markdown/, pdf/
pnpm check          # format, lint, types, unit tests, contributions
pnpm test:browser   # each product's Chromium suite
pnpm test:quality   # scroll smoothness and opening speed budgets
pnpm test:vscode    # real VS Code; VSCODE_EXECUTABLE=… to test Cursor
pnpm package        # the .vsix
```

This repository's `main` is the VS Code and Cursor extension only. The
desktop app, the web app, the iPad app and the DeepSeek Harness integration
are preserved, frozen, on the `hosts-snapshot-2026-11-21` branch
([docs/HOSTS_PLAN.md](docs/HOSTS_PLAN.md)).

## License

MIT. Bundled libraries and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Lumiere is not affiliated with or endorsed by Obsidian.
